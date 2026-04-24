import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { detectUnsafeOutput } from "../security/guardrails.js";
import {
  FinalPlanSchema,
  makeDecisionLog,
  type PlannerState,
} from "../graph/state.js";

export type PlanSynthesizerDependencies = {
  model: ChatOpenAI;
};

const PlanSynthesisSchema = z.object({
  summary: z.string(),
  safetyFlags: z.array(z.string()),
});

export const runPlanSynthesizerAgent = async (
  state: PlannerState,
  deps: PlanSynthesizerDependencies,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest || !state.budgetAssessment) {
    return {};
  }

  const blocked = state.safetyFlags.some((flag) =>
    flag.startsWith("BLOCKED_PROMPT_INJECTION"),
  );
  const selectedDestination = state.destinationCandidates[0]?.name ?? "Not resolved";
  const selectedFlightOfferId = state.selectedFlightOfferId ?? undefined;
  const selectedReturnFlightOfferId = state.selectedReturnFlightOfferId ?? undefined;

  if (blocked) {
    const summary =
      "Request blocked by risk guard due to prompt-injection patterns. No unsafe planning output generated.";
    const unsafeOutputFlags = detectUnsafeOutput(summary);
    const mergedSafetyFlags = [
      ...new Set([...state.safetyFlags, ...unsafeOutputFlags]),
    ];
    const finalPlan = FinalPlanSchema.parse({
      summary,
      selectedDestination,
      selectedFlightOfferId,
      selectedReturnFlightOfferId,
      itinerary: state.itineraryDraft,
      budget: state.budgetAssessment,
      packingList: state.packingList,
      safetyFlags: mergedSafetyFlags,
    });

    return {
      finalPlan,
      safetyFlags: mergedSafetyFlags,
      decisionLog: [
        makeDecisionLog({
          agent: "plan_synthesizer",
          inputSummary: "Synthesized final travel plan artifact",
          keyEvidence: [
            `destination=${selectedDestination}`,
            `itineraryDays=${state.itineraryDraft.length}`,
            `safetyFlags=${finalPlan.safetyFlags.length}`,
          ],
          outputSummary: "Produced safe refusal plan",
          riskFlags: unsafeOutputFlags,
        }),
      ],
    };
  }

  const structuredModel = deps.model.withStructuredOutput(PlanSynthesisSchema, {
    name: "PlanSynthesis",
  });

  const generated = await structuredModel.invoke(`
You are a travel plan synthesizer. Produce a concise summary and any safety flags for the following trip plan.

Destination: ${selectedDestination}
Itinerary days: ${state.itineraryDraft.length}
Outbound flight: ${selectedFlightOfferId ?? "none"}
Return flight: ${selectedReturnFlightOfferId ?? "none"}
Budget: ${state.budgetAssessment.estimatedTotal.toFixed(2)} / ${state.budgetAssessment.budgetLimit.toFixed(2)} (${state.budgetAssessment.withinBudget ? "within budget" : "over budget"})
Packing items: ${state.packingList.length}
Existing safety flags: ${state.safetyFlags.join(", ") || "none"}

Return a summary (2-3 sentences) and any additional safety flags you detect.
`);

  const unsafeOutputFlags = detectUnsafeOutput(generated.summary);
  const mergedSafetyFlags = [
    ...new Set([...state.safetyFlags, ...generated.safetyFlags, ...unsafeOutputFlags]),
  ];

  const finalPlan = FinalPlanSchema.parse({
    summary: generated.summary,
    selectedDestination,
    selectedFlightOfferId,
    selectedReturnFlightOfferId,
    itinerary: state.itineraryDraft,
    budget: state.budgetAssessment,
    packingList: state.packingList,
    safetyFlags: mergedSafetyFlags,
  });

  return {
    finalPlan,
    safetyFlags: [...new Set([...generated.safetyFlags, ...unsafeOutputFlags])],
    decisionLog: [
      makeDecisionLog({
        agent: "plan_synthesizer",
        inputSummary: "Synthesized final travel plan artifact via LLM",
        keyEvidence: [
          `destination=${selectedDestination}`,
          `itineraryDays=${state.itineraryDraft.length}`,
          `safetyFlags=${finalPlan.safetyFlags.length}`,
        ],
        outputSummary: "Produced complete travel plan",
        riskFlags: unsafeOutputFlags,
      }),
    ],
  };
};
