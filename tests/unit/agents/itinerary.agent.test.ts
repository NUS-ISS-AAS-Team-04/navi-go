import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";

import { runItineraryAgent } from "../../../src/agents/itinerary.agent.js";
import type { PlannerState } from "../../../src/graph/state.js";
import { FakeStructuredChatModel } from "../../helpers/fake-model.js";

const makeBaseState = (): PlannerState => ({
  userRequest: {
    userId: "u1",
    requestText: "Plan a culture-heavy trip",
    originIata: "SFO",
    destinationHint: "Rome",
    destinationCityCode: "ROM",
    destinationIata: "FCO",
    travelStartDate: "2026-09-01",
    travelEndDate: "2026-09-03",
    budget: 2200,
    adults: 1,
    children: 0,
    interests: ["history", "food"],
  },
  preferences: {
    travelStyle: "balanced",
    prioritizedInterests: ["history", "food"],
    preferredPace: "normal",
    accommodationPreference: "midrange",
  },
  destinationCandidates: [
    {
      name: "Rome",
      country: "Italy",
      iataCode: "FCO",
      cityCode: "ROM",
      rationale: "Best for history and food",
    },
  ],
  flightOptions: [],
  returnFlightOptions: [],
  weatherRisks: null,
  itineraryDraft: [],
  budgetAssessment: null,
  packingList: [],
  safetyFlags: [],
  decisionLog: [],
  finalPlan: null,
  naturalLanguage: null,
  parsedRequest: null,
  pendingQuestions: null,
  selectedFlightOfferId: null,
  selectedReturnFlightOfferId: null,
});

describe("itinerary agent", () => {
  it("builds concrete non-duplicated daily activities", async () => {
    const state = makeBaseState();

    const fakeModel = new FakeStructuredChatModel({
      ItineraryDraft: {
        itineraryDraft: [
          {
            date: "2026-09-01",
            theme: "history in Colosseum",
            activities: ["Morning visit to Colosseum", "Evening walk around Roman Forum"],
            weatherNote: "Sunny and warm",
          },
          {
            date: "2026-09-02",
            theme: "food in Trastevere",
            activities: ["Indoor cooking class", "Evening food tour"],
            weatherNote: "High rain risk; prioritize indoor venues",
          },
          {
            date: "2026-09-03",
            theme: "history in Pantheon",
            activities: ["Explore Pantheon", "Coffee at Piazza della Rotonda"],
            weatherNote: "Clear skies",
          },
        ],
      },
    }) as unknown as ChatOpenAI;

    const update = await runItineraryAgent(state, {
      model: fakeModel,
      searchFlights: async () => [],
      fetchWeather: async () => ({
        location: "Rome, Italy",
        timezone: "Europe/Rome",
        daily: [
          {
            date: "2026-09-01",
            weatherCode: 1,
            temperatureMax: 29,
            temperatureMin: 21,
            precipitationProbabilityMax: 10,
            riskLevel: "LOW",
          },
          {
            date: "2026-09-02",
            weatherCode: 95,
            temperatureMax: 25,
            temperatureMin: 18,
            precipitationProbabilityMax: 85,
            riskLevel: "HIGH",
          },
          {
            date: "2026-09-03",
            weatherCode: 2,
            temperatureMax: 27,
            temperatureMin: 19,
            precipitationProbabilityMax: 20,
            riskLevel: "LOW",
          },
        ],
        highRiskDates: ["2026-09-02"],
      }),
    });

    expect(update.itineraryDraft).toHaveLength(3);

    const activitySignatures = update.itineraryDraft!.map((day) =>
      day.activities.join(" | "),
    );
    expect(new Set(activitySignatures).size).toBe(activitySignatures.length);

    expect(update.itineraryDraft?.[0]?.activities.join(" ")).toContain("Colosseum");
    expect(update.itineraryDraft?.[1]?.activities.join(" ").toLowerCase()).toContain("indoor");
  });

  it("falls back to destination-derived anchors for unknown city codes", async () => {
    const base = makeBaseState();
    const state: PlannerState = {
      ...base,
      destinationCandidates: [
        {
          name: "Oslo",
          country: "Norway",
          iataCode: "OSL",
          cityCode: "OSL",
          rationale: "Provided by user",
        },
      ],
      userRequest: {
        ...base.userRequest!,
        destinationHint: "Oslo",
        destinationCityCode: "OSL",
        destinationIata: "OSL",
      },
    };

    const fakeModel = new FakeStructuredChatModel({
      ItineraryDraft: {
        itineraryDraft: [
          {
            date: "2026-09-01",
            theme: "Oslo Old Town exploration",
            activities: ["Walk through Oslo Old Town", "Visit local museum"],
            weatherNote: "Cool and clear",
          },
          {
            date: "2026-09-02",
            theme: "Vigeland Park tour",
            activities: ["Morning stroll in Vigeland Park", "Lunch at Mathallen"],
            weatherNote: "Partly cloudy",
          },
          {
            date: "2026-09-03",
            theme: "Opera House visit",
            activities: ["Tour Oslo Opera House", "Harbor walk"],
            weatherNote: "Clear",
          },
        ],
      },
    }) as unknown as ChatOpenAI;

    const update = await runItineraryAgent(state, {
      model: fakeModel,
      searchFlights: async () => [],
      fetchWeather: async () => ({
        location: "Oslo, Norway",
        timezone: "Europe/Oslo",
        daily: [
          {
            date: "2026-09-01",
            weatherCode: 1,
            temperatureMax: 20,
            temperatureMin: 12,
            precipitationProbabilityMax: 15,
            riskLevel: "LOW",
          },
          {
            date: "2026-09-02",
            weatherCode: 1,
            temperatureMax: 19,
            temperatureMin: 11,
            precipitationProbabilityMax: 15,
            riskLevel: "LOW",
          },
          {
            date: "2026-09-03",
            weatherCode: 1,
            temperatureMax: 18,
            temperatureMin: 10,
            precipitationProbabilityMax: 15,
            riskLevel: "LOW",
          },
        ],
        highRiskDates: [],
      }),
    });

    expect(update.itineraryDraft?.[0]?.activities.join(" ")).toContain("Oslo Old Town");
    expect(update.itineraryDraft?.[0]?.theme).toContain("Oslo Old Town");
  });

  it("marks pre-arrival dates as transit days when flight arrives later", async () => {
    const state = makeBaseState();

    const fakeModel = new FakeStructuredChatModel({
      ItineraryDraft: {
        itineraryDraft: [
          {
            date: "2026-09-01",
            theme: "Transit to Rome",
            activities: ["Take flight F-LATE on route SFO-HND → HND-FCO", "Keep this day flexible for airport transfers and check-in"],
            weatherNote: "Transit day; start destination activities after arrival on 2026-09-02.",
          },
          {
            date: "2026-09-02",
            theme: "Arrival in Rome",
            activities: ["Arrive via flight F-LATE", "Complete immigration, transfer, and hotel check-in", "Light evening walk near historic center"],
            weatherNote: "Arrival day; keep plans light before full exploration starts.",
          },
          {
            date: "2026-09-03",
            theme: "history in Roman Forum",
            activities: ["Explore Roman Forum", "Lunch at Campo de' Fiori"],
            weatherNote: "Clear skies",
          },
        ],
      },
    }) as unknown as ChatOpenAI;

    const update = await runItineraryAgent(state, {
      model: fakeModel,
      searchFlights: async () => [
        {
          offerId: "F-LATE",
          totalPrice: 310,
          currency: "USD",
          seats: 2,
          route: ["SFO-HND", "HND-FCO"],
          departureAt: "2026-09-01T18:00:00",
          arrivalAt: "2026-09-02T22:10:00",
          carriers: ["ZZ"],
        },
      ],
      fetchWeather: async () => ({
        location: "Rome, Italy",
        timezone: "Europe/Rome",
        daily: [
          {
            date: "2026-09-01",
            weatherCode: 1,
            temperatureMax: 29,
            temperatureMin: 21,
            precipitationProbabilityMax: 10,
            riskLevel: "LOW",
          },
          {
            date: "2026-09-02",
            weatherCode: 2,
            temperatureMax: 27,
            temperatureMin: 20,
            precipitationProbabilityMax: 25,
            riskLevel: "LOW",
          },
          {
            date: "2026-09-03",
            weatherCode: 1,
            temperatureMax: 28,
            temperatureMin: 20,
            precipitationProbabilityMax: 15,
            riskLevel: "LOW",
          },
        ],
        highRiskDates: [],
      }),
    });

    expect(update.itineraryDraft?.[0]?.theme).toBe("Transit to Rome");
    expect(update.itineraryDraft?.[0]?.activities[0]).toContain("F-LATE");
    expect(update.itineraryDraft?.[1]?.theme).toBe("Arrival in Rome");
    expect(update.itineraryDraft?.[2]?.theme).toMatch(/history in /);
  });
});
