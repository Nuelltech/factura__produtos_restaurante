import express from "express";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

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

// Endpoint principal
app.post("/process-fatura", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Ficheiro não enviado" });
        }

        const filePath = req.file.path;
        const fileData = fs.readFileSync(filePath);

        const aiResponse = await client.chat.completions.create({
            model: "gpt-4.1-preview",
            messages: [
                { 
                    role: "system", 
                    content: "Extrai dados de faturas. Devolve JSON com supplier_code, supplier_description, purchase_date e items [{qty, unit_supplier, price_unit, price_total, vat_rate}]." 
                },
                {
                    role: "user",
                    content: [
                        { type: "input_file", data: fileData, name: req.file.originalname },
                        { type: "text", text: "Extrai os dados e devolve JSON limpo e válido." }
                    ]
                }
            ]
        });

        const jsonText = aiResponse.choices[0].message.content;
        const data = JSON.parse(jsonText);

        // Inserir itens na Raw_Purchase_Items
        const insertSQL = `
            INSERT INTO Raw_Purchase_Items
            (purchase_id, supplier_id, supplier_code, supplier_description, qty, unit_supplier, price_unit, price_total, vat_rate, purchase_date, processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `;

        for (const item of data.items) {
            await pool.execute(insertSQL, [
                null,                           // purchase_id
                null,                           // supplier_id
                data.supplier_code || null,
                data.supplier_description || null,
                item.qty,
                item.unit_supplier,
                item.price_unit,
                item.price_total,
                item.vat_rate,
                data.purchase_date
            ]);
        }

        fs.unlinkSync(filePath); // apaga ficheiro

        res.json({ status: "ok", data });

    } catch (err) {
        console.error("Erro no processamento:", err);
        res.status(500).json({ error: err.message });
    }
});

// Usado pelo Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado na porta ${PORT}`));
