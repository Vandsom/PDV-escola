# PDV Modular

O frontend estático e o backend Express são publicados no Vercel. As rotas `/api/*` são encaminhadas para `api/index.js`; Authentication e Firestore continuam no Firebase. Para o exemplo didático de RBAC visual, o módulo `api-gateway.js` também consulta o perfil do usuário no Firestore após o login.

## Preparar o Firebase

1. Crie um projeto Firebase e configure Authentication (E-mail/senha) e Firestore.
2. Registre um app Web e copie `apiKey`, `authDomain`, `projectId` e `appId` para `firebase-config.js`. A chave web identifica o app e não substitui regras de segurança; restrinja-a no Google Cloud.
3. Ative Authentication com o provedor E-mail/senha e crie os usuários necessários.
4. Crie o Firestore. Cada documento em `produtos` precisa de `codigoBarras` (texto), `nome` (texto), `preco` (número) e estoque numérico no campo `estoque` ou `quantidade`.
5. No projeto Vercel, configure `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` como variáveis de ambiente para as Serverless Functions. A chave privada deve ser armazenada como secret; não a comite no repositório.
6. Importe o repositório no Vercel e faça o deploy. O `vercel.json` redireciona `/api/*` para o Express em `api/index.js`.

O backend recalcula o total usando os preços no Firestore. A venda e a baixa de estoque são escritas na mesma transação; itens sem estoque suficiente não são vendidos.

## Portal e cargos

Crie um documento na coleção `usuarios` usando como ID o UID do usuário em Firebase Authentication. Exemplo para o funcionário de caixa:

```json
{
  "nome": "Ana Silva",
  "email": "ana@ceep.edu.br",
  "role": "operador_caixa"
}
```

Valores aceitos para `role`: `operador_caixa`, `operador_estoque`, `gerente_vendas` e `admin`. O ID deve ser exatamente o UID, porque o frontend consulta `usuarios/{uid}`. Cada cargo operacional abre somente sua tela; `admin` abre o painel central e pode navegar pelos módulos.

O `role` do Firestore controla a navegação visual deste exercício. Como o cliente pode ser alterado pelo próprio usuário, isso **não** protege dados ou operações sensíveis. Regras do Firestore e endpoints do backend devem validar permissões de forma independente.

## Administradores

O portal autentica com Firebase Authentication. Estar autenticado, ou ter `role: "admin"` no documento Firestore, não concede por si só permissão para excluir: a função verifica a assinatura do ID token e exige o custom claim `role: "admin"`.

Conceda o claim somente em ambiente confiável usando Firebase Admin SDK, nunca no navegador. Exemplo para um script administrativo executado localmente com credenciais seguras:

```js
const user = await admin.auth().getUser(uid);
await admin.auth().setCustomUserClaims(uid, {
  ...user.customClaims,
  role: "admin"
});
```

O usuário precisa renovar o token (sair e entrar novamente) para receber o claim atualizado. A exclusão usa o ID do documento do produto no Firestore.

## Deploy contínuo

Conecte o repositório GitHub ao Vercel para criar deployments automáticos em cada push e previews para Pull Requests. Configure no painel do Vercel as variáveis `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` nos ambientes de Preview e Production. O Vercel executa as Serverless Functions Node a partir da pasta `api` e usa `vercel.json` para encaminhar as rotas.

## Execução local

Instale as dependências na raiz com `npm install` e execute localmente com `vercel dev`. Configure as variáveis Firebase no ambiente local (por exemplo, em `.env.local`, que não deve ser versionado) para testar as funções.