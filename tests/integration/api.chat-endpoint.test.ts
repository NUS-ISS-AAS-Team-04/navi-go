import type { ChatOpenAI } from "@langchain/openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPlannerGraph } from "../../src/graph/builder.js";
import { createApiServer } from "../../src/interfaces/api/server.js";
import { createInMemoryCheckpointer } from "../../src/persistence/checkpointer.js";
import { FakeStructuredChatModel } from "../helpers/fake-model.js";

describe("plan chat API endpoint", () => {
  let app: Awaited<ReturnType<typeof createApiServer>>;

  beforeAll(async () => {
    const fakeModel = new FakeStructuredChatModel((key, prompt) => {
      switch (key) {
        case "RequirementExtraction":
          return {
            requestText: null,
            originIata: null,
            destinationHint: "Rome",
            destinationCityCode: "ROM",
            destinationIata: "FCO",
            travelStartDate: null,
            travelEndDate: null,
            budget: 1800,
            adults: 1,
            children: null,
            interests: ["history"],
          };
        case "FormCompletion":
          {
            const hasStartDate = prompt.includes("travelStartDate:");
            const hasEndDate = prompt.includes("travelEndDate:");
            if (!hasStartDate || !hasEndDate) {
              return {
                isComplete: false,
                userRequest: null,
                pendingQuestions: [
                  "What is your planned departure date (format: YYYY-MM-DD)?",
                  "What is your return date (format: YYYY-MM-DD)?",
                ],
              };
            }
            return {
              isComplete: true,
              userRequest: {
                userId: "anonymous",
                requestText: "Plan a history-focused trip to Rome",
                destinationHint: "Rome",
                destinationCityCode: "ROM",
                destinationIata: "FCO",
                travelStartDate: "2026-08-01",
                travelEndDate: "2026-08-03",
                budget: 1800,
                adults: 1,
                children: 0,
                interests: ["history"],
              },
              pendingQuestions: [],
            };
          }
        case "PreferenceExtraction":
          return {
            travelStyle: "balanced",
            prioritizedInterests: ["history"],
            preferredPace: "normal",
            accommodationPreference: "midrange",
          };
        case "DestinationSuggestions":
          return {
            candidates: [
              {
                name: "Rome",
                country: "Italy",
                iataCode: "FCO",
                cityCode: "ROM",
                rationale: "Fits history-oriented request",
              },
            ],
          };
        case "ItineraryDraft":
          return {
            itineraryDraft: [
              {
                date: "2026-08-01",
                theme: "Arrival in Rome",
                activities: ["Arrive at FCO", "Check-in", "Evening passeggiata"],
                weatherNote: "Sunny and warm",
              },
              {
                date: "2026-08-02",
                theme: "Ancient Rome",
                activities: ["Colosseum tour", "Roman Forum", "Lunch in Monti"],
                weatherNote: "Hot; carry water",
              },
              {
                date: "2026-08-03",
                theme: "Departure",
                activities: ["Check-out", "Transfer to FCO", "Fly home"],
                weatherNote: "Clear",
              },
            ],
          };
        case "BudgetAssessment":
          return {
            estimatedTotal: 1200,
            budgetLimit: 1800,
            withinBudget: true,
            optimizationTips: ["Budget is healthy; keep a small buffer."],
          };
        case "PackingList":
          return { packingList: ["Passport", "Charger", "Sunscreen", "Hat"] };
        case "RiskGuardScan":
          return { safetyFlags: [], blocked: false };
        case "PlanSynthesis":
          return {
            summary: "3-day Rome history trip within budget.",
            safetyFlags: [],
          };
        default:
          return {};
      }
    }) as unknown as ChatOpenAI;

    const graph = await buildPlannerGraph({
      model: fakeModel,
      checkpointer: createInMemoryCheckpointer(),
      itineraryAgentDependencies: {
        searchFlights: async () => [
          {
            offerId: "offer-rome-1",
            totalPrice: 499.25,
            currency: "USD",
            seats: 4,
            route: ["JFK", "FCO"],
            departureAt: "2026-08-01T09:00:00Z",
            arrivalAt: "2026-08-01T17:00:00Z",
            carriers: ["AZ"],
          },
        ],
        fetchWeather: async () => ({
          location: "Rome, Italy",
          timezone: "Europe/Rome",
          daily: [
            {
              date: "2026-08-01",
              weatherCode: 1,
              temperatureMax: 31,
              temperatureMin: 23,
              precipitationProbabilityMax: 10,
              riskLevel: "LOW",
            },
            {
              date: "2026-08-02",
              weatherCode: 1,
              temperatureMax: 30,
              temperatureMin: 22,
              precipitationProbabilityMax: 5,
              riskLevel: "LOW",
            },
            {
              date: "2026-08-03",
              weatherCode: 1,
              temperatureMax: 29,
              temperatureMin: 21,
              precipitationProbabilityMax: 5,
              riskLevel: "LOW",
            },
          ],
          highRiskDates: [],
        }),
      },
    });

    app = await createApiServer({ graph });
  });

  afterAll(async () => {
    await app.close();
  });

  it("starts chat planning and asks for missing fields", async () => {
    const threadId = "thread-chat-1";

    const response = await app.inject({
      method: "POST",
      url: "/plan/chat",
      payload: {
        threadId,
        scenario: "integration-test-chat",
        naturalLanguage: "Plan a history-focused trip to Rome",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("awaiting_input");
    expect(body.pendingQuestions.length).toBeGreaterThan(0);
    expect(body.parsedRequest).toBeDefined();
    expect(body.parsedRequest.budget).toBe(1800);
  });

  it("resumes chat planning with missing fields and completes", async () => {
    const threadId = "thread-chat-2";

    await app.inject({
      method: "POST",
      url: "/plan/chat",
      payload: {
        threadId,
        scenario: "integration-test-chat",
        naturalLanguage: "Plan a history-focused trip to Rome",
      },
    });

    const resumeResponse = await app.inject({
      method: "POST",
      url: "/plan/chat/resume",
      payload: {
        threadId,
        scenario: "integration-test-chat",
        answers: {
          travelStartDate: "2026-08-01",
          travelEndDate: "2026-08-03",
        },
      },
    });

    expect(resumeResponse.statusCode).toBe(200);
    const body = resumeResponse.json();
    expect(body.status).toBe("complete");
    expect(body.finalPlan.selectedDestination).toBe("Rome");
  });
});
