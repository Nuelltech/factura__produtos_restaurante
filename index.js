// index.js - pipeline multimodal usando gpt-4.1-preview (imagem por URL)
// Não usa OCR local. Usa apenas LLM multimodal.
// Requer: openai@4.x, node-fetch, mysql2, dotenv, cors, express

import express from "express";
import fetch from "node-fetch";
import { OpenAI } from "openai";
import cors from "cors";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// OpenAI client
const OPENAI_KEY = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) console.error("⚠️ OPENAI_KEY / OPENAI_API_KEY não definido nas env vars.");
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// MySQL pool
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
  port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10
});

// ----------------- Helpers de normalização -----------------
function normalizeNumber(str) {
  if (str === null || str === undefined) return null;
  let s = String(str).trim();
  if (s === "") return null;
  s = s.replace(/\u00A0/g, "").replace(/\s+/g, "");
  // 1.234,56 -> 1234.56
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    if (s.indexOf(",") !== -1 && s.indexOf(".") === -1) s = s.replace(",", ".");
    if (/^\d+(\.\d{3})+$/.test(s) && s.indexOf(",") === -1) s = s.replace(/\./g, "");
  }
  s = s.replace(/[^\d\.\-]/g, "");
  const f = parseFloat(s);
  return Number.isFinite(f) ? f : null;
}

function extractProductCodeFromDesc(desc) {
  if (!desc) return null;
  const m = desc.match(/^\s*([0-9]{1,6})\b/);
  if (m) return m[1];
  const m2 = desc.match(/\b(?:REF|CÓD|COD|ART|REF\.)[:\s\-]*([0-9]{1,6})\b/i);
  if (m2) return m2[1];
  return null;
}

function normalizeUnit(u) {
  if (!u) return null;
  const s = String(u).toUpperCase().trim();
  if (s.startsWith("UN")) return "UN";
  if (s.startsWith("GR") || s === "G") return "GR";
  if (s.startsWith("KG")) return "KG";
  if (s.startsWith("L") || s.startsWith("LT")) return "L";
  if (s.match(/PET|BIB|EB/)) return s;
  if (s === "U") return "UN";
  if (s.length <= 3) return s;
  return s.slice(0, 3);
}

function normalizeVat(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, "").replace(",", ".");
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Math.abs(n - 23) < 1) return 23.0;
  if (Math.abs(n - 13) < 1) return 13.0;
  if (Math.abs(n - 6) < 1) return 6.0;
  return Number.isFinite(n) ? n : null;
}

function cleanItem(parsedItem) {
  const item = { ...parsedItem };
  if (!item.product_desc && item.description) item.product_desc = item.description;

  if (!item.product_code) {
    const c = extractProductCodeFromDesc(item.product_desc || "");
    if (c) item.product_code = c;
  }

  item.qty = normalizeNumber(item.qty);
  item.price_unit = normalizeNumber(item.price_unit);
  item.price_total = normalizeNumber(item.price_total);
  item.vat_rate = normalizeVat(item.vat_rate);
  item.unit_supplier = normalizeUnit(item.unit_supplier || item.unit || "");

  // heuristics
  if ((item.price_unit === null || item.price_unit === 0) && item.price_total !== null && item.qty) {
    if (item.qty !== 0) {
      const calcUnit = +(item.price_total / item.qty).toFixed(2);
      if (calcUnit >= 0.01 && calcUnit < 10000) item.price_unit = calcUnit;
    }
  }

  if ((item.price_total === null || item.price_total === 0) && item.qty && item.price_unit) {
    item.price_total = +(item.qty * item.price_unit).toFixed(2);
  }

  if (item.qty && item.qty >= 1000) {
    const alt = parseFloat(String(item.qty).replace(/\.?0+$/, ""));
    if (alt < 1000) item.qty = alt;
  }

  if (item.qty && Math.abs(item.qty - Math.round(item.qty)) < 0.0001) item.qty = Math.round(item.qty);
  if (item.price_unit !== null && item.price_unit < 0.01) {
    if (item.price_total && item.qty && item.qty > 0) {
      const candidate = +(item.price_total / item.qty).toFixed(2);
      if (candidate >= 0.01) item.price_unit = candidate;
      else item.price_unit = null;
    } else item.price_unit = null;
  }

  if (item.price_unit !== null) item.price_unit = +item.price_unit.toFixed(2);
  if (item.price_total !== null) item.price_total = +item.price_total.toFixed(2);
  if (item.qty !== null) item.qty = +item.qty.toFixed(3);
  if (item.vat_rate !== null) item.vat_rate = +item.vat_rate.toFixed(2);

  return item;
}

function sanitizeParsed(parsed) {
  const out = { ...parsed };
  out.items = Array.isArray(parsed.items) ? parsed.items.map(cleanItem) : [];
  if (out.purchase_date) {
    const d1 = out.purchase_date.match(/(\d{4})[-\/](\d{2})[-\/](\d{2})/);
    if (!d1) {
      const d2 = out.purchase_date.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
      if (d2) out.purchase_date = `${d2[3]}-${d2[2]}-${d2[1]}`;
      else out.purchase_date = null;
    }
  }
  if (out.supplier_nif) {
    const nif = String(out.supplier_nif).replace(/\D/g, "");
    out.supplier_nif = nif.length === 9 ? nif : null;
  }
  return out;
}

// ----------------- DB helpers -----------------
async function getSupplierIdByNif(nif) {
  if (!nif) return null;
  const conn = await db.getConnection();
  try {
    const [rows] = await conn.execute("SELECT id FROM Suppliers WHERE supplier_nif = ? LIMIT 1", [nif]);
    if (rows && rows.length) return rows[0].id;
    return null;
  } finally {
    conn.release();
  }
}

async function createSupplier(nif, name) {
  const conn = await db.getConnection();
  try {
    const [res] = await conn.execute("INSERT INTO Suppliers (supplier_nif, supplier_name) VALUES (?, ?)", [nif, name]);
    return res.insertId;
  } finally {
    conn.release();
  }
}

async function inserirItems(parsed) {
  const conn = await db.getConnection();
  try {
    const sql = `
      INSERT INTO Raw_Purchase_Items
        (purchase_id, purchase_date, supplier_id, supplier_description,
         product_code, product_desc, qty, unit_supplier, price_unit,
         price_total, vat_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    for (const item of parsed.items) {
      await conn.execute(sql, [
        parsed.purchase_id || null,
        parsed.purchase_date || null,
        parsed.supplier_id || null,
        parsed.supplier_description || null,
        item.product_code || null,
        item.product_desc || null,
        item.qty || null,
        item.unit_supplier || null,
        item.price_unit || null,
        item.price_total || null,
        item.vat_rate || null
      ]);
    }
  } finally {
    conn.release();
  }
}

// ----------------- LLM multimodal call -----------------
async function extractTextFromResponse(resp) {
  // Try common fields used by SDK
  if (!resp) return null;
  // 1) prefer output_text
  if (resp.output_text && typeof resp.output_text === "string") return resp.output_text;
  // 2) older shape: resp.output -> array of { content: [...] }
  if (Array.isArray(resp.output)) {
    // scan for text content in outputs
    const parts = [];
    for (const out of resp.output) {
      if (out.type === "message" && Array.isArray(out.content)) {
        for (const c of out.content) {
          if (c.type === "output_text" && c.text) parts.push(c.text);
          if (c.type === "message_text" && c.text) parts.push(c.text);
        }
      } else if (typeof out === "string") {
        parts.push(out);
      } else if (out.content && Array.isArray(out.content)) {
        for (const c of out.content) {
          if (c.type === "output_text" && c.text) parts.push(c.text);
        }
      }
    }
    if (parts.length) return parts.join("\n");
  }
  // 3) fallback: JSON.stringify
  try {
    return JSON.stringify(resp);
  } catch {
    return String(resp);
  }
}

const LLM_SYSTEM_PROMPT = `
És um extrator de dados de faturas portuguesas. RESPONDE SOMENTE COM JSON VÁLIDO — NADA MAIS.
Se não puderes extrair um campo, devolve null (não texto explicativo).
Extrai: purchase_id, purchase_date, supplier_description, supplier_nif, items[].
Cada item: product_code, product_desc, qty, unit_supplier, price_unit, price_total, vat_rate.
Formato OBRIGATÓRIO:
{
  "purchase_id": "",
  "purchase_date": "",
  "supplier_description": "",
  "supplier_nif": "",
  "items": [
    {
      "product_code": "",
      "product_desc": "",
      "qty": 0,
      "unit_supplier": "",
      "price_unit": 0,
      "price_total": 0,
      "vat_rate": ""
    }
  ]
}
`;

// Use model gpt-4.1-preview with image_url
async function callMultimodalModelWithImageUrl(fileUrl, ocrHint = "") {
  const input = [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: fileUrl }
        },
        {
          type: "input_text",
          text: `${LLM_SYSTEM_PROMPT}\n\nContexto adicional (se houver): ${ocrHint}`
        }
      ]
    }
  ];

  // Create response
  const resp = await openai.responses.create({
    model: "gpt-4.1-preview",
    input,
    max_output_tokens: 3000
  });
  return resp;
}

// ----------------- Endpoint principal -----------------
app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body ?? {};
    if (!fileUrl) return res.status(400).json({ error: "fileUrl não fornecido" });

    console.log("Recebido fileUrl:", fileUrl);

    // Verifica acesso ao arquivo
    const fileResp = await fetch(fileUrl, { method: "GET" });
    if (!fileResp.ok) {
      console.error("Falha a baixar fileUrl:", fileResp.status, fileResp.statusText);
      return res.status(400).json({ error: "Não foi possível descarregar a imagem (fileUrl inválido ou inacessível)" });
    }
    console.log("Fatura acessível. tamanho:", fileResp.headers.get("content-length") || "unknown");

    // Chama LLM multimodal (imagem por URL)
    let llmResp;
    try {
      llmResp = await callMultimodalModelWithImageUrl(fileUrl);
    } catch (err) {
      console.error("Erro na chamada multimodal:", err);
      return res.status(500).json({ error: "Erro na chamada multimodal", details: String(err) });
    }

    // Extrai texto/JSON do LLM
    const raw = await extractTextFromResponse(llmResp);
    console.log("LLM raw output (início):", raw?.slice?.(0, 1000) ?? "(vazio)");

    // Forçar a remover blocos ``` se existirem e extrair o JSON contido
    let cleaned = raw;
    if (!cleaned) {
      return res.status(500).json({ error: "LLM devolveu vazio" });
    }
    // Remove possíveis code fences
    cleaned = cleaned.replace(/```(?:json|js|text)?/gi, "").replace(/```/g, "").trim();

    // Tentar extrair primeiro objecto JSON dentro do texto (caso o LLM tenha texto a mais)
    let jsonText = cleaned;
    // tenta localizar a primeira '{' e o último '}' que envolvem JSON
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = cleaned.slice(firstBrace, lastBrace + 1);
    }

    // Parse
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      console.error("Falha ao parsear JSON do LLM. raw start:", cleaned.slice(0, 1000));
      return res.status(500).json({ error: "LLM não devolveu JSON válido", raw: cleaned });
    }

    // Sanitize & fix
    parsed = sanitizeParsed(parsed);

    // supplier lookup/create by NIF
    let supplierId = null;
    if (parsed.supplier_nif) {
      supplierId = await getSupplierIdByNif(parsed.supplier_nif);
      if (!supplierId && (process.env.AUTO_CREATE_SUPPLIER || "true") === "true") {
        supplierId = await createSupplier(parsed.supplier_nif, parsed.supplier_description || null);
        console.log("Created supplier id:", supplierId);
      }
    }
    parsed.supplier_id = supplierId || null;

    // Clean each item and insert
    parsed.items = Array.isArray(parsed.items) ? parsed.items.map(cleanItem) : [];
    await inserirItems(parsed);

    console.log("Inseridos itens:", parsed.items.length);
    return res.json({ status: "ok", parsed });

  } catch (err) {
    console.error("Erro no endpoint /process-fatura:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// Test endpoint: enviar fileUrl e obter raw LLM output (sem inserir)
app.post("/debug-llm", async (req, res) => {
  try {
    const { fileUrl } = req.body ?? {};
    if (!fileUrl) return res.status(400).json({ error: "fileUrl required" });
    const resp = await callMultimodalModelWithImageUrl(fileUrl);
    return res.json({ raw: resp });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
