import test from "node:test";
import assert from "node:assert/strict";
import { GEO_PRESETS } from "../src/defaultPresets.js";

test("preset:ai_services includes Google Gemini, AI Studio, and DeepMind domains", () => {
  const aiPreset = GEO_PRESETS.find((p) => p.id === "preset:ai_services");
  assert.ok(aiPreset, "preset:ai_services must exist");

  const requiredAiDomains = [
    "gemini.google.com",
    "*.gemini.google.com",
    "aistudio.google.com",
    "*.aistudio.google.com",
    "generativelanguage.googleapis.com",
    "alkalimining-pa.googleapis.com",
    "proactivebackend-pa.googleapis.com",
    "deepmind.google",
    "*.deepmind.google",
    "labs.google",
    "notebooklm.google.com",
    "ai.google.dev",
  ];

  for (const domain of requiredAiDomains) {
    assert.ok(
      aiPreset.domains.includes(domain),
      `preset:ai_services must include domain: ${domain}`
    );
  }
});

test("preset:ip_check includes checkip.amazonaws.com, ip-api.com, speedtest.net, and ip.me", () => {
  const ipPreset = GEO_PRESETS.find((p) => p.id === "preset:ip_check");
  assert.ok(ipPreset, "preset:ip_check must exist");

  const requiredIpDomains = [
    "checkip.amazonaws.com",
    "ip-api.com",
    "*.ip-api.com",
    "speedtest.net",
    "*.speedtest.net",
    "myip.is",
    "ip.me",
  ];

  for (const domain of requiredIpDomains) {
    assert.ok(
      ipPreset.domains.includes(domain),
      `preset:ip_check must include domain: ${domain}`
    );
  }
});
