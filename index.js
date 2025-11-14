import express from "express";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

// Configuração do cliente OpenAI
const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// Conexão MySQL
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
});

// Endpoint principal para upload de fatura
app.post("/process-fatura", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Ficheiro não enviado" });
    }

    const filePath = req.file.path;
    const fileData = fs.readFileSync(filePath);

    // Converte imagem para base64
    const base64Image = fileData.toString("base64");

    // Processa a imagem usando a API multimodal OpenAI
    const aiResponse = await client.responses.create({
      model: "gpt-4o", // conferir sempre o modelo correto na tua conta
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image: {
                data: base64Image,
                mime_type: req.file.mimetype || "image/jpeg"
              }
            },
            {
              type: "input_text",
              text: "Extrai os dados da fatura em JSON com os campos: supplier_description, supplier_code, purchase_date, items[].qty, items[].unit_supplier, items[].price_unit, items[].price_total, items[].vat_rate"
            }
          ]
        }
      ]
    });

    // O texto retornado pelo modelo
    const jsonText = aiResponse.output_text;

    let json;
    try {
      json = JSON.parse(jsonText);
    } catch (err) {
      console.error("Erro ao parsear JSON do modelo:", jsonText);
      fs.unlinkSync(filePath);
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

    fs.unlinkSync(filePath); // remove o ficheiro temporário

    res.json({ status: "ok", data: json });
  } catch (err) {
    console.error("Erro no processamento:", err);
    res.status(500).json({ error: err.message });
  }
});

// Porta fornecida pelo Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado na porta ${PORT}`));
