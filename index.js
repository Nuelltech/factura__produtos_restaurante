// index.js
import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// === IMPORTANT: middleware para ler JSON e urlencoded (DEVE vir antes das rotas) ===
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// === OpenAI client (usa OPENAI_API_KEY ou fallback OPENAI_KEY) ===
const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
if (!apiKey) {
  console.error("ERRO: falta a chave OpenAI. Define OPENAI_API_KEY no Render.");
  // não lançamos aqui para permitir o serviço subir e responder com erro legível nas requests
}
const openai = new OpenAI({ apiKey });

// === MySQL pool (ajusta nomes das env vars conforme o teu .env no Render) ===
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ===== Endpoint que espera { "fileUrl": "..." } =====
app.post("/process-fatura", async (req, res) => {
  try {
    console.log("REQ BODY RAW:", req.body); // debug: confirma o que chega

    const { fileUrl } = req.body ?? {};
    if (!fileUrl || fileUrl === "null" || typeof fileUrl !== "string") {
      return res.status(400).json({ error: "Parâmetro 'fileUrl' não fornecido" });
    }

    console.log("Recebido fileUrl:", fileUrl);

    // 1) Buscar a imagem do URL e validar
    const imgResp = await fetch(fileUrl);
    if (!imgResp.ok) {
      console.error("Erro ao baixar a imagem:", imgResp.status, imgResp.statusText);
      return res.status(400).json({ error: "Não foi possível baixar a imagem (fileUrl inválido)" });
    }

    // Podemos enviar apenas a URL ao modelo multimodal (image_url)
    // 2) Chamada à OpenAI Responses API (usar modelo multimodal disponível na tua conta)
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY não definido no servidor" });
    }

    const aiResponse = await openai.responses.create({
      model: "gpt-4.1-mini", // ajusta se necessário (usa um modelo multimodal disponível)
      input: [
        {
          type: "image_url",
          image_url: { url: fileUrl }
        },
        {
          type: "input_text",
          text: "Extrai os dados da fatura em JSON com os campos: supplier_description, supplier_code, purchase_date, items[].qty, items[].unit_supplier, items[].price_unit, items[].price_total, items[].vat_rate"
        }
      ],
    });

    console.log("AI response raw:", aiResponse?.output_text?.slice?.(0, 1000) ?? "(sem texto)");

    const jsonText = aiResponse.output_text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      console.error("Falha ao parsear JSON do modelo. output_text:", jsonText);
      return res.status(500).json({ error: "Falha ao parsear JSON retornado pela AI", raw: jsonText });
    }

    // 3) Inserir na tabela Raw_Purchase_Items (valida se parsed.items existe)
    if (!Array.isArray(parsed.items)) parsed.items = [];

    for (const item of parsed.items) {
      await pool.execute(
        `INSERT INTO Raw_Purchase_Items
         (purchase_id, supplier_id, supplier_code, supplier_description, qty, unit_supplier, price_unit, price_total, vat_rate, purchase_date, processed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          parsed.purchase_id || null,
          parsed.supplier_id || null,
          parsed.supplier_code || null,
          parsed.supplier_description || null,
          item.qty || 0,
          item.unit_supplier || null,
          item.price_unit || 0,
          item.price_total || 0,
          item.vat_rate || 0,
          parsed.purchase_date || null,
        ]
      );
    }

    return res.json({ status: "ok", data: parsed });
  } catch (err) {
    console.error("Erro no processamento:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado na porta ${PORT}`));
