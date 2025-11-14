import express from "express";
import fetch from "node-fetch";
import { OpenAI } from "openai";
import cors from "cors";
import dotenv from "dotenv";
import Tesseract from "tesseract.js";
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

// Função para inserir itens na tabela
async function inserirItems(purchaseId, supplierId, supplier_code, supplier_description, purchase_date, items) {
  const conn = await db.getConnection();
  try {
    const sql = `
      INSERT INTO Raw_Purchase_items
        (purchase_id, supplier_id, supplier_code, supplier_description, qty, unit_supplier, price_unit, price_total, vat_rate, purchase_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    for (const item of items) {
      await conn.execute(sql, [
        purchaseId,
        supplierId,
        supplier_code,
        supplier_description,
        item.qty || null,
        item.unit_supplier || null,
        item.price_unit || null,
        item.price_total || null,
        item.vat_rate ? parseFloat(item.vat_rate.replace('%','')) : null,
        purchase_date || null
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

    // 1️⃣ Baixar a imagem
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) {
      return res.status(400).json({ error: "Falha ao descarregar o ficheiro." });
    }

    const arrayBuffer = await fileResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log("📄 Fatura descarregada com sucesso.");

    // 2️⃣ OCR com Tesseract
    console.log("🔍 A processar OCR...");
    const { data: { text: ocrText } } = await Tesseract.recognize(buffer, "por", {
      logger: m => console.log(m)
    });
    console.log("📝 OCR concluído.");

    // 3️⃣ Extrair JSON via OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
Tu és um extrator de dados de faturas.
Responde SOMENTE com JSON válido.
Não acrescentes explicações nem blocos de código.
Se não conseguires extrair algo, coloca null.
A estrutura deve ser:

{
  "supplier_description": "",
  "supplier_code": "",
  "purchase_date": "",
  "items": [
    {
      "description": "",
      "qty": 0,
      "unit_supplier": "",
      "price_unit": 0,
      "price_total": 0,
      "vat_rate": ""
    }
  ]
}
`
        },
        { role: "user", content: ocrText }
      ]
    });

    const text = completion.choices?.[0]?.message?.content;

    // 4️⃣ Garantir JSON válido
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.log("⚠️ Modelo não devolveu JSON válido:", text);
      return res.status(500).json({ error: "Falha ao parsear JSON", raw_output: text });
    }

    console.log("🧾 JSON extraído com sucesso:", parsed);

    // 5️⃣ Inserir na base de dados
    try {
      await inserirItems(
        null, // purchase_id
        null, // supplier_id
        parsed.supplier_code,
        parsed.supplier_description,
        parsed.purchase_date,
        parsed.items
      );
      console.log("✅ Dados inseridos na tabela Raw_Purchase_items");
    } catch (dbErr) {
      console.error("❌ Erro ao inserir na base de dados:", dbErr);
      return res.status(500).json({ error: "Erro ao inserir na base de dados", details: dbErr.message });
    }

    // 6️⃣ Retornar JSON final
    return res.json(parsed);

  } catch (error) {
    console.error("❌ Erro geral:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor a correr na porta ${PORT}`));



