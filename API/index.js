const admin = require("firebase-admin");
const express = require("express");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    })
  });
}

const app = express();
const db = admin.firestore();

app.use(express.json({ limit: "1mb" }));

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

async function requireAdmin(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer (.+)$/i);

  if (!match) return sendError(res, 401, "Autenticação necessária.");

  try {
    const decodedToken = await admin.auth().verifyIdToken(match[1]);
    if (decodedToken.role !== "admin") {
      return sendError(res, 403, "Esta operação exige acesso administrativo.");
    }
    req.auth = decodedToken;
    return next();
  } catch (error) {
    return sendError(res, 401, "Token inválido ou expirado.");
  }
}

app.get("/api/produtos/:codigo", async (req, res) => {
  try {
    const snapshot = await db.collection("produtos")
      .where("codigoBarras", "==", req.params.codigo)
      .limit(1)
      .get();

    if (snapshot.empty) return sendError(res, 404, "Produto não encontrado no estoque.");

    const product = snapshot.docs[0];
    return res.status(200).json({ id: product.id, ...product.data() });
  } catch (error) {
    console.error("Erro ao consultar catálogo:", error);
    return sendError(res, 500, "Não foi possível consultar o catálogo.");
  }
});

app.post("/api/vendas/processar", async (req, res) => {
  const { itens, metodoPagamento } = req.body || {};
  if (!Array.isArray(itens) || itens.length === 0) {
    return sendError(res, 400, "Informe ao menos um produto para a venda.");
  }

  const quantities = new Map();
  for (const item of itens) {
    if (typeof item.productId !== "string" || !Number.isInteger(item.quantidade) || item.quantidade < 1) {
      return sendError(res, 400, "Há itens inválidos no carrinho.");
    }
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantidade);
  }

  const productRefs = [...quantities.keys()].map((id) => db.collection("produtos").doc(id));
  const saleRef = db.collection("vendas").doc();

  try {
    const receipt = await db.runTransaction(async (transaction) => {
      const productSnapshots = await Promise.all(productRefs.map((ref) => transaction.get(ref)));
      let total = 0;
      const receiptItems = [];

      productSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) throw new Error("Um produto do carrinho não existe mais.");

        const product = snapshot.data();
        const quantity = quantities.get(snapshot.id);
        const stockField = Number.isFinite(product.estoque) ? "estoque" : "quantidade";
        const available = product[stockField];

        if (!Number.isFinite(available) || available < quantity) {
          throw new Error(`Estoque insuficiente para ${product.nome || snapshot.id}.`);
        }
        if (!Number.isFinite(product.preco) || product.preco < 0) {
          throw new Error(`Preço inválido para ${product.nome || snapshot.id}.`);
        }

        total += product.preco * quantity;
        receiptItems.push({
          productId: snapshot.id,
          nome: product.nome || "Produto",
          preco: product.preco,
          quantidade: quantity,
        });
        transaction.update(productRefs[index], { [stockField]: available - quantity });
      });

      transaction.set(saleRef, {
        data: admin.firestore.FieldValue.serverTimestamp(),
        itens: receiptItems,
        total,
        metodoPagamento: String(metodoPagamento || "PIX"),
        status: "CONCLUIDA",
      });

      return { itens: receiptItems, total };
    });

    return res.status(201).json({
      reciboId: saleRef.id,
      itens: receipt.itens,
      total: receipt.total,
      metodoPagamento: String(metodoPagamento || "PIX"),
      message: "Venda finalizada com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao processar venda:", error);
    const isClientError = /não existe|insuficiente|Preço inválido/i.test(error.message);
    return sendError(res, isClientError ? 400 : 500, error.message || "Erro ao processar transação.");
  }
});

app.delete("/api/produtos/:id", requireAdmin, async (req, res) => {
  try {
    const productRef = db.collection("produtos").doc(req.params.id);
    const product = await productRef.get();
    if (!product.exists) return sendError(res, 404, "Produto não encontrado.");

    await productRef.delete();
    return res.status(200).json({ message: "Produto removido do estoque." });
  } catch (error) {
    console.error("Erro ao excluir produto:", error);
    return sendError(res, 500, "Não foi possível excluir o produto.");
  }
});

app.post("/api/usuarios", requireAdmin, async (req, res) => {
  const { nome, email, senha, role } = req.body || {};
  const allowedRoles = ["admin", "operador_caixa", "operador_estoque", "gerente_vendas"];

  if (typeof nome !== "string" || !nome.trim()) {
    return sendError(res, 400, "Informe o nome do funcionário.");
  }
  if (typeof email !== "string" || !email.trim()) {
    return sendError(res, 400, "Informe um e-mail válido.");
  }
  if (typeof senha !== "string" || senha.length < 6) {
    return sendError(res, 400, "A senha deve ter pelo menos 6 caracteres.");
  }
  if (!allowedRoles.includes(role)) {
    return sendError(res, 400, "O cargo selecionado não é válido.");
  }

  let userRecord;
  try {
    // Admin SDK cria a conta no servidor sem alterar a sessão do Admin no navegador.
    userRecord = await admin.auth().createUser({
      email: email.trim(),
      password: senha,
      displayName: nome.trim(),
    });

    // Claims são usados pelo backend para autorizar operações administrativas.
    await admin.auth().setCustomUserClaims(userRecord.uid, { role });

    // UID como ID garante que o portal encontre usuarios/{uid} após o login.
    await db.collection("usuarios").doc(userRecord.uid).set({
      nome: nome.trim(),
      email: email.trim(),
      role,
    });

    return res.status(201).json({
      uid: userRecord.uid,
      message: "Funcionário cadastrado com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao cadastrar funcionário:", error);

    // Compensa a criação no Auth caso a etapa seguinte não seja concluída.
    if (userRecord) {
      try {
        await admin.auth().deleteUser(userRecord.uid);
      } catch (cleanupError) {
        console.error("Falha ao remover conta criada parcialmente:", cleanupError);
      }
    }

    if (error.code === "auth/email-already-exists") {
      return sendError(res, 409, "Já existe uma conta cadastrada com esse e-mail.");
    }
    return sendError(res, 500, "Não foi possível cadastrar o funcionário.");
  }
});

module.exports = app;
