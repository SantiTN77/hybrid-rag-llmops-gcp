# Production Incident Response & SLA Escalation Handbook
Document ID: doc-004-incident-response-sla
Version: 4.2
Owner: Site Reliability Engineering (SRE)
Last Updated: 2026-10-12

## 1. Severity Classification & Response SLAs
Meridian SRE classifies production incidents into four severity tiers with binding Mean Time to Acknowledge (MTTA) and Mean Time to Mitigate (MTTM) targets:
- **SEV-1 (Critical Outage)**: Complete loss of customer-facing RAG API availability, active security/IAM breach, or confirmed PII leakage. **MTTA: 15 minutes**, **MTTM: 60 minutes**, executive status update every **30 minutes**.
- **SEV-2 (Major Degradation)**: Error rate exceeding 5% for 5 consecutive minutes, P95 latency > 8,000 ms, or hallucination rate spiking above 15% in canary monitoring. **MTTA: 30 minutes**, **MTTM: 4 hours**, stakeholder update every **2 hours**.
- **SEV-3 (Minor Impact)**: Non-critical ingestion job failure where cached Firestore chunks remain healthy, or single-region metric delay. **MTTA: 4 business hours**, **MTTM: 2 business days**.
- **SEV-4 (Low / Cosmetic)**: UI styling defects or documentation drift. Triaged during weekly sprint planning.

## 2. Automated Rollback & Circuit Breakers
If a newly deployed Cloud Run revision exhibits HTTP 5xx error rates above **2.5%** over a 3-minute sliding window, SRE operators MUST immediately shift 100% of traffic back to the previous known-good revision using `gcloud run services update-traffic --to-revisions=<prev>=100`.

For Vertex AI upstream throttling (`HTTP 429 RESOURCE_EXHAUSTED`), the RAG API implements exponential backoff with jitter: initial delay `250ms`, multiplier `2.0`, max retries `3`, and total deadline `12 seconds`.

## 3. Post-Incident Review (Blameless Postmortem)
Every SEV-1 and SEV-2 incident requires a blameless postmortem document published within **48 hours** of mitigation. Action items classified as P0 reliability fixes must be completed within **14 calendar days** and linked to an automated regression test in the LLMOps evaluation golden dataset if the incident involved an AI grounding failure.
