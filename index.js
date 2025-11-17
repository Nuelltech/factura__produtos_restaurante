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

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
  port: process.env.MYSQL_PORT || 3306
});

// 👉 Agora insere os novos campos na tabela atualizada
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
        null, // supplier_id futuro
        parsed.supplier_description || null,
        item.product_code || null,
        item.product_desc || null,
        item.qty || null,
        item.unit_supplier || null,
        item.price_unit || null,
        item.price_total || null,
        item.vat_rate ? parseFloat(item.vat_rate.replace('%', '')) : null,
      ]);
    }

    console.log("✅ Inserido com sucesso na Raw_Purchase_Items");

  } finally {
    conn.release();
  }
}

app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl)
      return res.status(400).json({ error: "fileUrl é obrigatório." });

    console.log("📥 URL recebido:", fileUrl);

    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok)
      return res.status(400).json({ error: "Falha ao descarregar ficheiro." });

    const arrayBuffer = await fileResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log("📄 Imagem descarregada.");

    console.log("🔍 A processar OCR...");
    const { data: { text: ocrText } } = await Tesseract.recognize(buffer, "por", {
      logger: m => console.log(m)
    });
    console.log("📝 OCR concluído.");

    // ------- OPENAI EXTRAÇÃO AVANÇADA -------
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
És um extrator inteligente de dados de faturas portuguesas.
Responde apenas com JSON válido.

REGRAS IMPORTANTES:
- NUNCA inventes valores.
- Se algo não existir na fatura: devolve null.
- Se existir ambiguidade entre quantidade e preço, segue a lógica:
  - price_total ≈ price_unit × qty
  - Se “x 24”, “x30”, “cx24”, “emb. 24” ⇒ qty = 24
  - Se a linha tiver duas casas decimais → normalmente é preço
- Extrai sempre o código do produto quando aparecer como:
  - “REF”, “CÓD.”, “COD”, “ART”, “REFERÊNCIA”, “PROD.”
- Extrai sempre o NIF do fornecedor (NIF, CONtribuinte, VAT, TIN).

FORMATO OBRIGATÓRIO DO JSON:
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

Nomes dos campos obrigatórios:
- purchase_id: número da fatura, doc nº, invoice nº, número do documento
- supplier_description: nome legal do fornecedor
- supplier_nif: NIF do fornecedor (9 dígitos português)
`
        },
        { role: "user", content: ocrText }
      ]
    });

    const text = completion.choices?.[0]?.message?.content;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return res.status(500).json({
        error: "OpenAI não devolveu JSON válido.",
        raw_output: text
      });
    }

    console.log("🧾 JSON extraído:", parsed);

    await inserirItems(parsed);

    return res.json(parsed);

  } catch (error) {
    console.error("❌ Erro:", error);
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor iniciado na porta ${PORT}`));
