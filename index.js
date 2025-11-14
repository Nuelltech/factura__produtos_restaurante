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


// Criar pool de conexões usando as variáveis do Render
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

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

    // 3️⃣ Enviar texto ao OpenAI para extrair JSON
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

    // 4️⃣ Garantir que é JSON válido
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.log("⚠️ Modelo não devolveu JSON válido:", text);
      return res.status(500).json({ error: "Falha ao parsear JSON", raw_output: text });
    }

    // 5️⃣ Inserir na base de dados
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Inserir cada item na tabela Raw_Purchase_Items
      const insertItemQuery = `
        INSERT INTO Raw_Purchase_Items
        (supplier_description, supplier_code, purchase_date, description, qty, unit_supplier, price_unit, price_total, vat_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      for (const item of parsed.items) {
        await connection.execute(insertItemQuery, [
          parsed.supplier_description,
          parsed.supplier_code,
          parsed.purchase_date,
          item.description,
          item.qty,
          item.unit_supplier,
          item.price_unit,
          item.price_total,
          item.vat_rate
        ]);
      }

      await connection.commit();
      console.log("✅ Itens inseridos com sucesso na base de dados.");
    } catch (dbErr) {
      await connection.rollback();
      console.error("❌ Erro ao inserir na base de dados:", dbErr);
      return res.status(500).json({ error: "Falha ao inserir na base de dados", details: dbErr.message });
    } finally {
      connection.release();
    }

    // 6️⃣ Retornar JSON processado
    return res.json(parsed);

  } catch (error) {
    console.error("❌ Erro geral:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor a correr na porta ${PORT}`));


