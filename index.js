import express from "express";
import fetch from "node-fetch"; // Para buscar a imagem via URL
import OpenAI from "openai";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" })); // para receber JSON com fileUrl

// Configuração OpenAI
const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// Conexão MySQL
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
});

// Endpoint principal
app.post("/process-fatura", async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl || fileUrl === "null") {
      return res.status(400).json({ error: "Parâmetro 'fileUrl' não fornecido" });
    }

    console.log("Recebido fileUrl:", fileUrl);

    // Buscar a imagem do URL
    const response = await fetch(fileUrl);
    if (!response.ok) {
      return res.status(400).json({ error: "Não foi possível baixar a imagem" });
    }

    const buffer = await response.arrayBuffer();
    const base64Image = Buffer.from(buffer).toString("base64");

    console.log("Imagem convertida para base64, tamanho:", base64Image.length);

    // Chamada à OpenAI GPT-4o para extrair dados
    const aiResponse = await client.responses.create({
      model: "gpt-4o", // modelo multimodal
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: fileUrl
            },
            {
              type: "input_text",
              text: `Extrai os dados da fatura em JSON com os campos: 
              supplier_description, supplier_code, purchase_date, 
              items[].qty, items[].unit_supplier, items[].price_unit, 
              items[].price_total, items[].vat_rate`
            }
          ]
        }
      ]
    });

    const jsonText = aiResponse.output_text;
    console.log("Resposta AI:", jsonText);

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
          json.purchase_date || null
        ]
      );
    }

    res.json({ status: "ok", data: json });

  } catch (err) {
    console.error("Erro no processamento:", err);
    res.status(500).json({ error: err.message });
  }
});

// Porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado na porta ${PORT}`));
