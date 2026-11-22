# Staten Island Borough President Constituent Chatbot

Bilingual (English/Spanish) constituent chatbot for the Office of the
Staten Island Borough President (Vito Fossella), New York City, following
the North Bergen / Parsippany chatbot architecture.

- Index-first: answers come from a verified local topic index
  (`data/index.json`, 45 topics, expanded Nov 22, 2026 in HelpLine call-log
  demand order: Marriage Bureau first, then the agency directory,
  containerization, topography, trees/Clean Team, DOT streets, housing,
  utilities, case follow-up, events, recurring issues; casework topics then
  re-ranked by the office case log, with litter/Clean Team as the top
  casework topic and speed reducers and illegal parking split out). There is NO meetings
  module: the BP office does not hold council-style meetings and
  statenislandusa.com publishes no public events calendar.
- Scope split: topics cover (a) what the BP's office itself does
  (HelpLine, proclamations, appointments, Topographical Bureau, FOIL,
  veterans, tourism, filming) and (b) routing to NYC 311 and the right
  city agency for day-to-day services (potholes, streetlights, trash,
  snow, permits). City services are always framed as city services the
  BP's office can help escalate, never as BP office services.
- Backup: questions the index does not cover go to the Meta Model API only
  when `MODEL_API_KEY` is set, instructed to answer only from the approved
  trusted sources (`data/trusted-sources.json`) and otherwise return the
  HelpLine fallback verbatim.
- Emergencies get a 911 redirect. No personal information is collected.
- Answer style: one direct sentence first, then supporting details, then
  phone numbers / addresses / links in a Contact block at the end.
- Whole-word / whole-phrase keyword matching only.

## Design
Staten Island BP colors from statenislandusa.com: deep navy `#102e50` /
`#082059` with gold `#decc8c` (deepened to `#b08d3e` for text-weight
accents). Layout mirrors the North Bergen / Parsippany front end
(slim top bar, hero, topic cards, "Try asking" chips, sticky mobile composer).

## Run locally
```
npm install
node server.js
# http://localhost:3000  — health check at /health
```

## Deploy (Render)
Blueprint in `render.yaml` (one Starter web service, `staten-island-chatbot`).
Set `MODEL_API_KEY` in the Render dashboard Environment tab. Never commit it.
Deployment under Nick's accounts (GitHub `vmmi-nick`, new repo
`staten-island-chatbot`) comes after local QA passes.

## Verified basics (checked 2026-11-22 on statenislandusa.com)
- Borough Hall: 10 Richmond Terrace, Staten Island, NY 10301 (entrance on
  Stuyvesant Place), Mon-Fri 9:00 AM-5:00 PM
- Borough President: Vito Fossella. HelpLine (main): 718-816-2000.
  Fax 718-816-2152
- Proclamations/citations: Stephanie Slepian, 718-816-2136, three weeks ahead,
  pickup in person at Borough Hall
- Media: Nicholas Thompson 718-816-2115, Stephanie Slepian 718-816-2136
- FOIL: NYC Open Records Portal
- Topographical Bureau: house number applications ended Nov 2, 2026;
  NYC Dept. of City Planning takes over Jan 1, 2027
- Veterans: NYS Division of Veterans Services, Borough Hall 3rd floor,
  718-447-8787; VA Vet Center 60 Bay Street 718-816-4499

## Open items for production (not build blockers)
- Nick's prototype testing
- BP office sign-off contact
- Site-admin embed paste on statenislandusa.com
- Possible transfer to office-owned hosting / AI accounts
- Decisions pending: add visitstatenisland.com to trusted sources?
  (currently flagged NOT approved, discussion only; used as the tourism
  link in the tourism topic only)
