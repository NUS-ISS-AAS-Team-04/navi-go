import type { ChatOpenAI } from "@langchain/openai";

import { BudgetAssessmentSchema, makeDecisionLog, type PlannerState } from "../graph/state.js";

export type BudgetAgentDependencies = {
  model: ChatOpenAI;
};

export const runBudgetAgent = async (
  state: PlannerState,
  deps: BudgetAgentDependencies,
): Promise<Partial<PlannerState>> => {
  if (!state.userRequest || state.itineraryDraft.length === 0) {
    return {};
  }

  const selectedFlight = state.flightOptions.find(
    (f) => f.offerId === state.selectedFlightOfferId,
  );
  const selectedFlightPrice = selectedFlight?.totalPrice ?? 0;

  const selectedReturnFlight = state.returnFlightOptions.find(
    (f) => f.offerId === state.selectedReturnFlightOfferId,
  );
  const selectedReturnFlightPrice = selectedReturnFlight?.totalPrice ?? 0;

  const structuredModel = deps.model.withStructuredOutput(BudgetAssessmentSchema, {
    name: "BudgetAssessment",
  });

  const tripDays = state.itineraryDraft.length;
  const tripNights = Math.max(tripDays - 1, 0);
  const accommodationPreference =
    state.preferences?.accommodationPreference ?? "midrange";

  const generated = await structuredModel.invoke(`
You are a travel budget analyst. Evaluate the following trip against the user's budget.

User budget limit: ${state.userRequest.budget}
Trip duration: ${tripDays} days, ${tripNights} nights
Travelers: ${state.userRequest.adults} adults, ${state.userRequest.children} children
Accommodation preference: ${accommodationPreference}
Selected outbound flight: ${selectedFlight ? `${selectedFlight.offerId} at ${selectedFlight.totalPrice} ${selectedFlight.currency}` : "none"}
Selected return flight: ${selectedReturnFlight ? `${selectedReturnFlight.offerId} at ${selectedReturnFlight.totalPrice} ${selectedReturnFlight.currency}` : "none"}
Flight cost total: ${selectedFlightPrice + selectedReturnFlightPrice}
Itinerary days:
${state.itineraryDraft.map((d) => `- ${d.date}: ${d.theme}`).join("\n")}

Return a structured budget assessment with:
- estimatedTotal: your best estimate of total trip cost in the same currency as the budget
- budgetLimit: ${state.userRequest.budget}
- withinBudget: whether estimatedTotal <= budgetLimit
- optimizationTips: 1-3 actionable tips if over budget, or a reassurance tip if within budget
`);

  const budgetAssessment = BudgetAssessmentSchema.parse(generated);

  return {
    budgetAssessment,
    decisionLog: [
      makeDecisionLog({
        agent: "budget_agent",
        inputSummary: "Evaluated trip draft against budget constraints via LLM",
        keyEvidence: [
          `estimatedTotal=${budgetAssessment.estimatedTotal.toFixed(2)}`,
          `budget=${state.userRequest.budget.toFixed(2)}`,
          `accommodationPreference=${accommodationPreference}`,
          `selectedFlightOfferId=${selectedFlight?.offerId ?? "none"}`,
          `selectedReturnFlightOfferId=${selectedReturnFlight?.offerId ?? "none"}`,
          `flightCost=${(selectedFlightPrice + selectedReturnFlightPrice).toFixed(2)}`,
        ],
        outputSummary: budgetAssessment.withinBudget
          ? "Trip is currently budget-feasible"
          : "Trip exceeds budget and needs optimization",
        riskFlags: budgetAssessment.withinBudget ? [] : ["BUDGET_EXCEEDED"],
      }),
    ],
  };
};
