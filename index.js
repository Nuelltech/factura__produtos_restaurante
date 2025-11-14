import express from "express";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" }); // pasta temporária para uploads

// Configuração OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
});

// Conexão MySQL
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
});

// Endpoint para processar fatura
app.post("/process-fatura", upload.single("file"), async (req, res) => {
  try {
    console.log("Recebido req.file:", req.file);

    if (!req.file) {
      return res.status(400).json({ error: "Ficheiro não enviado" });
    }

    const filePath = req.file.path;
    const fileData = fs.readFileSync(filePath);

    // Chamada OpenAI para extrair dados da fatura
    const aiResponse = await client.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Extrai dados de faturas e devolve JSON válido." },
        {
          role: "user",
          content: [
            { type: "input_file", data: fileData, name: req.file.originalname },
            { type: "text", text: "Extrai fornecedor, NIF, data, número de fatura, items (qty, unit_supplier, price_unit, price_total, vat_rate)." }
          ]
        }
      ]
    });

    const jsonText = aiResponse.choices[0].message.content;
    const json = JSON.parse(jsonText);

    // Inserir os itens na tabela Raw_Purchase_Items
    for (const item of json.items) {
      const sql = `
        INSERT INTO Raw_Purchase_Items
        (purchase_id, supplier_id, supplier_code, supplier_description, qty, unit_supplier, price_unit, price_total, vat_rate, purchase_date, processed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await pool.execute(sql, [
        json.purchase_id || null,
        json.supplier_id || null,
        json.supplier_code || null,
        json.supplier_description || null,
        item.qty,
        item.unit_supplier,
        item.price_unit,
        item.price_total,
        item.vat_rate,
        json.purchase_date,
        0
      ]);
    }

    fs.unlinkSync(filePath); // Apaga ficheiro temporário

    res.json({ status: "ok", data: json });

  } catch (err) {
    console.error("Erro no processamento:", err);
    res.status(500).json({ error: err.message });
  }
});

// Porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado na porta ${PORT}`));
