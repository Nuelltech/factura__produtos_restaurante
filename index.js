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

const OPENAI_KEY = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) console.error("⚠️ OPENAI_KEY / OPENAI_API_KEY não definido nas env vars.");
const openai = new OpenAI({ apiKey: OPENAI_KEY });

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
  port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10
});

// Funções auxiliares para normalização etc. (mantém conforme mostrado)

function normalizeNumber(str) { /* ... */ }
function extractProductCodeFromDesc(desc) { /* ... */ }
function normalizeUnit(u) { /* ... */ }
function normalizeVat(v) { /* ... */ }
function cleanItem(parsedItem) { /* ... */ }
function sanitizeParsed(parsed) { /* ... */ }
async function getSupplierIdByNif(nif) { /* ... */ }
async function createSupplier(nif, name) { /* ... */ }
async function inserirItems(parsed) { /* ... */ }

async function extractTextFromResponse(resp) { /* ... */ }

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

// Função atualizada para usar base64 com Responses API
async function callMultimodalModelWithImageUrl(base64Image, ocrHint = "") {
  const input = [
    {
      role: "user",
      content: [
        {
          type: "input_image",
          image: base64Image
        },
        {
          type: "input_text",
          text: `${LLM_SYSTEM_PROMPT}\n\nContexto adicional: ${ocrHint}`
        }
      ]
    }
  ];

  return await openai.responses.create({
    model: "gpt-4.1-preview",
    input,
    max_output_tokens: 3000
  });
}

app.post("/process-fatura", async (req, res) => {
  try {
    const { fileBase64 } = req.body ?? {};
    if (!fileBase64) return res.status(400).json({ error: "fileBase64 não fornecido" });

    console.log("Recebido base64 image String, comprimento:", fileBase64.length);

    // Chamar LLM multimodal
    let llmResp;
    try {
      llmResp = await callMultimodalModelWithImageUrl(fileBase64);
    } catch (err) {
      console.error("Erro na chamada multimodal:", err);
      return res.status(500).json({ error: "Erro na chamada multimodal", details: String(err) });
    }

    // Extrair e limpar texto JSON
    const raw = await extractTextFromResponse(llmResp);
    console.log("LLM raw output (início):", raw?.slice?.(0, 1000) ?? "(vazio)");

    let cleaned = raw;
    if (!cleaned) return res.status(500).json({ error: "LLM devolveu vazio" });

    cleaned = cleaned.replace(/``````/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    let jsonText = cleaned;
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = cleaned.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      console.error("Falha ao parsear JSON do LLM. raw start:", cleaned.slice(0, 1000));
      return res.status(500).json({ error: "LLM não devolveu JSON válido", raw: cleaned });
    }

    parsed = sanitizeParsed(parsed);

    // Fornecedor lookup/insert
    let supplierId = null;
    if (parsed.supplier_nif) {
      supplierId = await getSupplierIdByNif(parsed.supplier_nif);
      if (!supplierId && (process.env.AUTO_CREATE_SUPPLIER || "true") === "true") {
        supplierId = await createSupplier(parsed.supplier_nif, parsed.supplier_description || null);
        console.log("Created supplier id:", supplierId);
      }
    }
    parsed.supplier_id = supplierId || null;

    parsed.items = Array.isArray(parsed.items) ? parsed.items.map(cleanItem) : [];
    await inserirItems(parsed);

    console.log("Inseridos itens:", parsed.items.length);
    return res.json({ status: "ok", parsed });

  } catch (err) {
    console.error("Erro no endpoint /process-fatura:", err);
    return res.status(500).json({ error: String(err) });
  }
});

app.post("/debug-llm", async (req, res) => {
  try {
    const { fileBase64 } = req.body ?? {};
    if (!fileBase64) return res.status(400).json({ error: "fileBase64 required" });
    const resp = await callMultimodalModelWithImageUrl(fileBase64);
    return res.json({ raw: resp });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
