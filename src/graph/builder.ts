import {
  END,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { ChatOpenAI } from "@langchain/openai";

import { runBudgetAgent, type BudgetAgentDependencies } from "../agents/budget.agent.js";
import { runDestinationAgent } from "../agents/destination.agent.js";
import { runFormCompleter, type FormCompleterDependencies } from "../agents/form-completer.agent.js";
import {
  runItineraryAgent,
  type ItineraryAgentDependencies,
  defaultItineraryDeps,
} from "../agents/itinerary.agent.js";
import { runPackingAgent, type PackingAgentDependencies } from "../agents/packing.agent.js";
import { runPlanSynthesizerAgent, type PlanSynthesizerDependencies } from "../agents/plan-synthesizer.agent.js";
import { runPreferenceAgent } from "../agents/preference.agent.js";
import { runRequirementParser } from "../agents/requirement-parser.agent.js";
import { runRiskGuardAgent, type RiskGuardDependencies } from "../agents/risk-guard.agent.js";
import { createPlanningModel } from "../config/models.js";
import { createPostgresCheckpointer } from "../persistence/checkpointer.js";
import {
  routeFromFormCompleter,
  routeFromRiskGuard,
  routeFromStart,
  routeFromSupervisor,
  runSupervisorNode,
} from "./routes.js";
import { PlannerStateAnnotation } from "./state.js";

export type PlannerGraphDependencies = {
  model?: ChatOpenAI;
  checkpointer?: BaseCheckpointSaver;
  itineraryAgentDependencies?: Omit<ItineraryAgentDependencies, "model">;
  budgetAgentDependencies?: Omit<BudgetAgentDependencies, "model">;
  packingAgentDependencies?: Omit<PackingAgentDependencies, "model">;
  planSynthesizerDependencies?: Omit<PlanSynthesizerDependencies, "model">;
  riskGuardDependencies?: Omit<RiskGuardDependencies, "model">;
  formCompleterDependencies?: Omit<FormCompleterDependencies, "model">;
};

export const buildPlannerGraph = async (
  deps: PlannerGraphDependencies = {},
) => {
  const model = deps.model ?? createPlanningModel();
  const checkpointer = deps.checkpointer ?? (await createPostgresCheckpointer());

  const graphBuilder = new StateGraph(PlannerStateAnnotation)
    .addNode("risk_guard", (state) => runRiskGuardAgent(state, { model, ...deps.riskGuardDependencies }))
    .addNode("supervisor", runSupervisorNode)
    .addNode("preference_agent", (state) => runPreferenceAgent(state, { model }))
    .addNode("destination_agent", (state) => runDestinationAgent(state, { model }))
    .addNode("itinerary_agent", (state) => {
      const itineraryDeps: ItineraryAgentDependencies = {
        model,
        ...defaultItineraryDeps,
        ...deps.itineraryAgentDependencies,
      };
      return runItineraryAgent(state, itineraryDeps);
    })
    .addNode("budget_agent", (state) => runBudgetAgent(state, { model, ...deps.budgetAgentDependencies }))
    .addNode("packing_agent", (state) => runPackingAgent(state, { model, ...deps.packingAgentDependencies }))
    .addNode("plan_synthesizer", (state) => runPlanSynthesizerAgent(state, { model, ...deps.planSynthesizerDependencies }))
    .addNode("requirement_parser", (state) => runRequirementParser(state, { model }))
    .addNode("form_completer", (state) => runFormCompleter(state, { model, ...deps.formCompleterDependencies }))
    .addConditionalEdges(START, routeFromStart)
    .addEdge("requirement_parser", "form_completer")
    .addConditionalEdges("form_completer", routeFromFormCompleter)
    .addConditionalEdges("risk_guard", routeFromRiskGuard)
    .addConditionalEdges("supervisor", routeFromSupervisor)
    .addEdge("preference_agent", "risk_guard")
    .addEdge("destination_agent", "risk_guard")
    .addEdge("itinerary_agent", "risk_guard")
    .addEdge("budget_agent", "risk_guard")
    .addEdge("packing_agent", "risk_guard")
    .addEdge("plan_synthesizer", END);

  return graphBuilder.compile({
    checkpointer,
    name: "navi-go-planner",
  });
};

export type PlannerCompiledGraph = Awaited<ReturnType<typeof buildPlannerGraph>>;
