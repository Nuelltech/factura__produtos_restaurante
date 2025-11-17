import express from "express";
import fetch from "node-fetch";
import { OpenAI } from "openai";
import cors from "cors";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Inicializar OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// Conexão MySQL
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
  port: process.env.MYSQL_PORT || 3306
});

// Modelo: instruções do assistente
const LLM_SYSTEM_PROMPT = `
Tu és um extrator de dados de faturas portuguesas.

Regressa APENAS JSON válido.
Se algo não existir, coloca null.

Estrutura obrigatória:

{
  "purchase_id": "",
  "purchase_date": "",
  "supplier_description": "",
  "supplier_id": "",
  "items": [
    {
      "product_code": "",
      "product_desc": "",
      "qty": "",
      "unit_supplier": "",
      "price_unit": "",
      "price_total": "",
      "vat_rate": ""
    }
  ]
}

Notas:
- purchase_id pode ser Invoice Nº, FT Nº, Documento Nº, Nº Fatura.
- supplier_id é o NIF (número fiscal).
- product_code é o código do artigo.
- product_desc é a descrição da linha do artigo.
- qty é quantidade real, nunca preço.
- price_unit é preço unitário.
- price_total é o total da linha.
- vat_rate é percentagem do IVA.
`;

// Função para enviar imagem via Responses API (input_image)
async function callMultimodalModel(fileUrl) {
  // 1) Baixar ficheiro bruto
  const imgResp = await fetch(fileUrl);
  if (!imgResp.ok) throw new Error("Falha ao descarregar imagem.");
  const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  const base64Image = imgBuffer.toString("base64");

  // 2) Montar input
  const input = [
    {
      role: "user",
      content: [
        { type: "input_image", image: base64Image },
        { type: "input_text", text: LLM_SYSTEM_PROMPT }
      ]
    }
  ];

  // 3) Chamada ao modelo
  const response = await openai.responses.create({
    model: "gpt-4.1-preview",
    input,
    max_output_tokens: 4000
  });

  return response.output_text;
}

// Função para inserir itens da fatura
async function inserirItems(parsed) {
  const conn = await db.getConnection();
  try {
    const sql = `
      INSERT INTO Raw_Purchase_Items
        (purchase_id, purchase_date, supplier_id, supplier_description,
         product_code, product_desc, qty, unit_supplier,
         price_unit, price_total, vat_rate)
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
        item.vat_rate ? parseFloat(item.vat_rate.replace("%","")) : null
      ]);
    }

  } finally {
    conn.release();
  }
}

// Endpoint principal
app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({ error: "fileUrl é obrigatório." });
    }

    console.log("📥 Recebido fileUrl:", fileUrl);

    // 1) Chamada multimodal
    let textOutput;
    try {
      textOutput = await callMultimodalModel(fileUrl);
    } catch (e) {
      console.error("Erro na chamada multimodal:", e);
      return res.status(500).json({ error: "Erro multimodal", details: e.message });
    }

    // 2) Validar JSON
    let parsed;
    try {
      parsed = JSON.parse(textOutput);
    } catch (err) {
      console.error("Falha a gerar JSON válido:", textOutput);
      return res.status(500).json({
        error: "OpenAI não devolveu JSON válido",
        raw_output: textOutput
      });
    }

    // 3) Inserir na base de dados
    try {
      await inserirItems(parsed);
      console.log("✅ Dados inseridos com sucesso.");
    } catch (dbErr) {
      console.error("Erro ao inserir na BD:", dbErr);
      return res.status(500).json({ error: "Erro BD", details: dbErr.message });
    }

    return res.json(parsed);

  } catch (error) {
    console.error("❌ Erro geral:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor a correr na porta ${PORT}`)
);
