// Staten Island Borough President Constituent Chatbot - deployable backend (Render)
// Answers come first from a verified local index (data/index.json).
// Questions the index does not cover are sent to the Meta Model API only
// when MODEL_API_KEY is set, and only with context from the approved
// trusted sources list (data/trusted-sources.json). Otherwise they return
// the Borough President's HelpLine fallback. No personal information is
// collected or stored. Question logging: matched questions are logged as topic counts only; unmatched question text is logged so index gaps can be fixed (see README). The BP office does not hold council-style meetings,
// so there is no meetings module; most day-to-day services on Staten Island
// are NYC agency services routed through 311, and the index says so.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL_API_KEY = process.env.MODEL_API_KEY || '';
const MODEL_ID = process.env.MODEL_ID || 'muse-wonder-1.0';

const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name), 'utf8'));
const index = loadJson('index.json');
const trustedSources = loadJson('trusted-sources.json');

const HELP_DESK = index.helpDeskPhone;

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- question logging ----------
// Privacy: matched questions are logged as topic counts only (the matched
// question text is NOT stored). Unmatched question text IS stored, only so
// gaps in the verified index can be identified and fixed. Names and contact
// details are never requested or stored.
// Render's filesystem is ephemeral, so every entry is also emitted as a
// structured CHATLOG console line, which lands in the Render service logs
// and survives restarts there. The local JSONL copy below lasts only while
// the instance lives.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const LOG_FILE = path.join(__dirname, 'logs', 'questions.jsonl');

function logAsk(entry) {
  const record = { ts: new Date().toISOString(), ...entry };
  try { console.log('CHATLOG ' + JSON.stringify(record)); } catch (e) {}
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  } catch (e) { /* ephemeral fs: the CHATLOG console line is the durable copy */ }
}

function readUnanswered() {
  const groups = new Map();
  let lines = [];
  try {
    lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  } catch (e) { return []; }
  for (const line of lines) {
    let r;
    try { r = JSON.parse(line); } catch (e) { continue; }
    if (r.matched || !r.question) continue;
    const norm = r.question.toLowerCase().replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
    const key = r.lang + '|' + norm;
    const g = groups.get(key) || { question: r.question, lang: r.lang, count: 0, modelUsed: false, firstSeen: r.ts, lastSeen: r.ts };
    g.count += 1;
    g.lastSeen = r.ts;
    g.modelUsed = g.modelUsed || Boolean(r.modelUsed);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}


// ---------- helpers ----------

function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalize(s) {
  return stripAccents(String(s || '').toLowerCase()).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectLang(question, requested) {
  if (requested === 'es' || requested === 'en') return requested;
  const q = String(question || '');
  if (/[¿¡áéíóúñ]/i.test(q)) return 'es';
  const n = ' ' + normalize(q) + ' ';
  const esHints = [' quien ', ' cuando ', ' donde ', ' como ', ' ayuda ', ' basura ', ' multa ', ' permiso ', ' bache ', ' nieve ', ' ruido ', ' agua ', ' arbol ', ' horario ', ' votar ', ' veterano ', ' proclamacion ', ' invitacion ', ' farola ', ' impuesto ',
    ' necesito ', ' quiero ', ' tengo ', ' puedo ', ' para ', ' una ', ' calle ', ' estacionamiento ', ' registro ', ' cita ', ' oficina ', ' numero ', ' casa ', ' luz ', ' factura ', ' refugio ', ' caso ', ' que ', ' del ', ' los ', ' las ', ' matrimonio ', ' divorcio ', ' nacimiento ', ' contenedor ', ' calefaccion ', ' inquilino ', ' comisaria ', ' contratar ', ' empleo '];
  return esHints.some((h) => n.includes(h)) ? 'es' : 'en';
}

const EMERGENCY = [
  'fire', 'smoke', 'burning', 'robbery', 'robbed', 'break in', 'breaking in', 'gun', 'shooting',
  'heart attack', 'chest pain', 'not breathing', 'unconscious', 'overdose', 'choking', 'bleeding',
  'car accident with injuries', 'emergency', 'fuego', 'incendio', 'humo', 'robo', 'atraco', 'disparo',
  'emergencia', 'no respira', 'inconsciente', 'sangrando', 'ataque al corazon'
];

function isEmergency(qn) {
  return EMERGENCY.some((w) => qn.includes(normalize(w)));
}

// Services the Borough President's office does not provide at all; never let
// a generic keyword match route these to the office.
const NOT_BP_SERVICE = [
  'passport', 'pasaporte', 'social security card', 'tarjeta de seguro social'
];

function matchTopic(qn) {
  let best = null;
  let bestScore = 0;
  for (const topic of index.topics) {
    let score = 0;
    for (const lang of ['en', 'es']) {
      for (const kw of topic.keywords[lang] || []) {
        const nkw = normalize(kw);
        // Whole-word / whole-phrase matching only: the question is space-padded
        // (' ' + normalize(q) + ' '), so padding the keyword the same way means
        // short keywords like "park" can no longer match inside "parking".
        if (nkw && qn.includes(' ' + nkw + ' ')) score += nkw.split(' ').length + 1;
      }
    }
    if (score > bestScore) { bestScore = score; best = topic; }
  }
  return bestScore > 0 ? best : null;
}

function fallbackAnswer(lang, reason) {
  return {
    kind: 'fallback',
    reason: reason || 'not-covered',
    lead: lang === 'es'
      ? 'No tengo una respuesta verificada para eso en las fuentes oficiales, así que no quiero adivinar.'
      : 'I do not have a verified answer for that in the official sources, so I do not want to guess.',
    details: [lang === 'es'
      ? 'Para un servicio de la ciudad de Nueva York, llame al 311. Para ayuda de la oficina del Presidente del Borough, o para escalar un problema con una agencia de la ciudad, llame a la Línea de Ayuda al 718-816-2000. Este chat no recopila información personal.'
      : 'For a New York City service, call 311. For help from the Borough President\u2019s office, or to escalate a problem with a city agency, call the HelpLine at 718-816-2000. This chat does not collect personal information.'],
    contact: [
      { label: lang === 'es' ? 'Línea de Ayuda del Presidente del Borough' : 'Borough President\u2019s HelpLine', value: HELP_DESK, href: `tel:+1${HELP_DESK.replace(/-/g, '')}` },
      { label: 'NYC 311', value: '311', href: 'tel:311' }
    ],
    source: null, sourceLabel: null
  };
}

function emergencyAnswer(lang) {
  return {
    kind: 'emergency',
    lead: lang === 'es'
      ? 'Esto suena como una emergencia. Llame al 911 ahora mismo.'
      : 'This sounds like an emergency. Call 911 right now.',
    details: [lang === 'es'
      ? 'Este chat no puede enviar ayuda. Para asuntos que no sean emergencias, llame al 311 para servicios de la ciudad o a la Línea de Ayuda del Presidente del Borough al 718-816-2000.'
      : 'This chat cannot dispatch help. For non-emergency matters, call 311 for city services or the Borough President\u2019s HelpLine at 718-816-2000.'],
    contact: [
      { label: lang === 'es' ? 'Emergencias' : 'Emergency', value: '911', href: 'tel:911' },
      { label: lang === 'es' ? 'Línea de Ayuda del Presidente del Borough' : 'Borough President\u2019s HelpLine', value: HELP_DESK, href: `tel:+1${HELP_DESK.replace(/-/g, '')}` }
    ],
    source: null, sourceLabel: null
  };
}

// ---------- optional model path (trusted sources only) ----------

function approvedDomains() {
  const domains = [];
  for (const tier of trustedSources.tiers) {
    for (const s of tier.sources) if (s.approved) domains.push(s.domain);
  }
  return domains;
}

function buildModelContext() {
  return index.topics.map((t) => {
    const a = t.en;
    return `TOPIC: ${t.id}\nSOURCE: ${t.source}\n${a.lead} ${a.details.join(' ')}`;
  }).join('\n\n');
}

async function askModel(question, lang) {
  const fallbackText = lang === 'es'
    ? `No tengo una respuesta verificada para eso. Llame a la Línea de Ayuda del Presidente del Borough al ${HELP_DESK} o al 311 para servicios de la ciudad.`
    : `I do not have a verified answer for that. Please call the Borough President\u2019s HelpLine at ${HELP_DESK}, or 311 for city services.`;
  const prompt = [
    'You are the constituent chatbot for the Office of the Staten Island Borough President, New York City.',
    'Answer ONLY from the facts provided below. Do not use outside knowledge.',
    'The only approved source domains are: ' + approvedDomains().join(', ') + '.',
    'Most day-to-day services on Staten Island are New York City agency services reached through 311, not Borough President\u2019s office services; never present a city agency service as a Borough President\u2019s office service.',
    'Open with one natural sentence that directly answers the question. Then give brief supporting details.',
    'End by naming the source page from the facts you used.',
    `Answer in ${lang === 'es' ? 'Spanish' : 'English'}, the language of the question.`,
    `If the facts below do not cover the question, reply with exactly this text and nothing else: ${fallbackText}`,
    'Never ask for or repeat personal information.',
    '',
    'VERIFIED FACTS:',
    buildModelContext(),
    '',
    'QUESTION: ' + question
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('https://api.meta.ai/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MODEL_API_KEY}` },
      body: JSON.stringify({ model: MODEL_ID, input: prompt, max_output_tokens: 500 })
    });
    if (!res.ok) return null;
    const payload = await res.json();
    let text = '';
    if (typeof payload.output_text === 'string') text = payload.output_text;
    if (!text && Array.isArray(payload.output)) {
      for (const item of payload.output) {
        for (const block of item.content || []) {
          if (typeof block.text === 'string') text += block.text;
        }
      }
    }
    text = text.trim();
    if (!text) return null;
    if (text === fallbackText) return fallbackAnswer(lang, 'model-insufficient');
    return {
      kind: 'model',
      lead: text.split('\n')[0],
      details: text.split('\n').slice(1).map((s) => s.trim()).filter(Boolean),
      contact: [
        { label: lang === 'es' ? 'Línea de Ayuda del Presidente del Borough' : 'Borough President\u2019s HelpLine', value: HELP_DESK, href: `tel:+1${HELP_DESK.replace(/-/g, '')}` }
      ],
      source: null, sourceLabel: null
    };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- routes ----------

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'staten-island-chatbot',
    modelConfigured: Boolean(MODEL_API_KEY),
    model: MODEL_API_KEY ? MODEL_ID : null,
    topics: index.topics.length,
    indexLastChecked: index.lastChecked
  });
});

app.get('/api/trusted-sources', (req, res) => {
  res.json(trustedSources);
});

app.post('/api/ask', async (req, res) => {
  const question = String((req.body && req.body.question) || '').slice(0, 1000);
  const lang = detectLang(question, req.body && req.body.lang);
  if (!question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }
  const qn = ' ' + normalize(question) + ' ';

  if (isEmergency(qn)) { logAsk({ lang, matched: true, topicId: 'emergency', modelUsed: false }); return res.json({ lang, ...emergencyAnswer(lang) }); }

  if (NOT_BP_SERVICE.some((w) => qn.includes(normalize(w)))) {
    logAsk({ lang, matched: false, question, modelUsed: false, reason: 'not-a-bp-service' });
    return res.json({ lang, ...fallbackAnswer(lang, 'not-a-bp-service') });
  }

  const topic = matchTopic(qn);
  if (topic) {
    const a = topic[lang] || topic.en;
    logAsk({ lang, matched: true, topicId: topic.id, modelUsed: false });
    return res.json({
      lang, kind: 'answer',
      lead: a.lead, details: a.details, contact: a.contact,
      source: topic.source, sourceLabel: topic.sourceLabel
    });
  }

  if (MODEL_API_KEY) {
    const modelResult = await askModel(question, lang);
    if (modelResult) {
      if (modelResult.kind === 'fallback') {
        logAsk({ lang, matched: false, question, modelUsed: true, reason: modelResult.reason || 'model-fallback' });
      } else {
        logAsk({ lang, matched: true, topicId: 'model', modelUsed: true });
      }
      return res.json({ lang, ...modelResult });
    }
  }

  logAsk({ lang, matched: false, question, modelUsed: Boolean(MODEL_API_KEY), reason: MODEL_API_KEY ? 'model-unavailable' : 'no-model-key' });
  return res.json({ lang, ...fallbackAnswer(lang, MODEL_API_KEY ? 'model-unavailable' : 'no-model-key') });
});


// Token-protected review of unmatched questions (enabled only when the
// ADMIN_TOKEN env var is set). Header: x-admin-token: <ADMIN_TOKEN>
app.get('/api/admin/unanswered', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(404).json({ error: 'not enabled' });
  if (req.get('x-admin-token') !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  res.json({ unanswered: readUnanswered() });
});

app.listen(PORT, () => {
  console.log(`Staten Island chatbot listening on port ${PORT}; model configured: ${Boolean(MODEL_API_KEY)}`);
});
