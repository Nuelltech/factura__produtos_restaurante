import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import mysql from "mysql2/promise";

dotenv.config();

const app = express();
app.use(express.json()); // Para processar JSON

// Configuração do cliente OpenAI
const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// Conexão MySQL
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
});

// Endpoint principal para processar faturas via URL
app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({ error: "Parâmetro 'fileUrl' não fornecido" });
    }

    // Chamada à API OpenAI (modelo multimodal)
    const aiResponse = await client.responses.create({
      model: "gpt-4.1-mini", // modelo compatível
      input: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: fileUrl }
            },
            {
              type: "input_text",
              text: "Extrai os dados da fatura em JSON com os campos: supplier_description, supplier_code, purchase_date, items[].qty, items[].unit_supplier, items[].price_unit, items[].price_total, items[].vat_rate"
            }
          ]
        }
      ]
    });

    const jsonText = aiResponse.output_text;

    let json;
    try {
      json = JSON.parse(jsonText);
    } catch (err) {
      console.error("Erro ao parsear JSON do modelo:", jsonText);
      return res.status(500).json({ error: "Falha ao parsear JSON do modelo" });
    }

    // Inserção na tabela Raw_Purchase_Items
    for (const item of json.items) {
      await pool.execute(
        `INSERT INTO Raw_Purchase_Items
          (purchase_id, supplier_id, supplier_code, supplier_description, qty, unit_supplier, price_unit, price_total, vat_rate, purchase_date, processed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          json.purchase_id || null,
          json.supplier_id || null,
          json.supplier_code || null,
          json.supplier_description || null,
          item.qty || 0,
          item.unit_supplier || null,
          item.price_unit || 0,
          item.price_total || 0,
          item.vat_rate || 0,
          json.purchase_date || null,
        ]
      );
    }

    res.json({ status: "ok", data: json });
  } catch (err) {
    console.error("Erro no processamento:", err);
    res.status(500).json({ error: err.message });
  }
});

// Porta fornecida pelo Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado na porta ${PORT}`));
