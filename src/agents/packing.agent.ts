import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { makeDecisionLog, type PlannerState } from "../graph/state.js";

export type PackingAgentDependencies = {
  model: ChatOpenAI;
};

const PackingListSchema = z.object({
  packingList: z.array(z.string()),
});

export const runPackingAgent = async (
  state: PlannerState,
  deps: PackingAgentDependencies,
): Promise<Partial<PlannerState>> => {
  if (!state.weatherRisks || !state.userRequest || state.itineraryDraft.length === 0) {
    return {};
  }

  const structuredModel = deps.model.withStructuredOutput(PackingListSchema, {
    name: "PackingList",
  });

  const generated = await structuredModel.invoke(`
You are a travel packing assistant. Create a packing checklist based on the trip details below.

Destination: ${state.destinationCandidates[0]?.name ?? "Unknown"}
Travel dates: ${state.userRequest?.travelStartDate ?? "unknown"} to ${state.userRequest?.travelEndDate ?? "unknown"}
Travelers: ${state.userRequest?.adults ?? 1} adults, ${state.userRequest?.children ?? 0} children

Weather forecast:
${state.weatherRisks.daily.map((d) => `- ${d.date}: max ${d.temperatureMax}°C, min ${d.temperatureMin}°C, precipitation ${d.precipitationProbabilityMax}%, risk ${d.riskLevel}`).join("\n")}

Itinerary:
${state.itineraryDraft.map((d) => `- ${d.date}: ${d.theme} — ${d.activities.join("; ")}`).join("\n")}

Return a concise, deduplicated packing list of essential items. Include travel documents, clothing suited to the weather, and gear for the activities.
`);

  return {
    packingList: generated.packingList,
    decisionLog: [
      makeDecisionLog({
        agent: "packing_agent",
        inputSummary: "Invoked LLM to generate packing checklist from weather and itinerary",
        keyEvidence: [
          `forecastDays=${state.weatherRisks.daily.length}`,
          `highRiskDays=${state.weatherRisks.highRiskDates.length}`,
        ],
        outputSummary: `Prepared ${generated.packingList.length} packing items`,
        riskFlags: [],
      }),
    ],
  };
};
