import { demoFixtures, evaluateExecution } from './openbell.mjs';

for (const [name, fixture] of Object.entries(demoFixtures)) {
  const receipt = evaluateExecution(fixture);
  console.log(JSON.stringify({ scenario: name, decision: receipt.decision, reasons: receipt.reasons, evidenceHash: receipt.evidenceHash }, null, 2));
}
