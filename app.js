let carrinho = [];
let metodoPagamento = 'PIX';
let currentRole = null;
let authStateVersion = 0;

// Cada cargo comum recebe uma única tela; admin inicia no painel central.
const roleHome = {
    operador_caixa: 'tela-caixa',
    operador_estoque: 'tela-estoque',
    gerente_vendas: 'tela-vendas',
    admin: 'tela-admin'
};

const inputCodigo = document.getElementById('input-codigo');
const listaItens = document.getElementById('carrinho-lista');
const totalUI = document.getElementById('total');
const subtotalUI = document.getElementById('subtotal');
const checkoutButton = document.getElementById('btn-finalizar');
const loginForm = document.getElementById('login-form');
const authStatus = document.getElementById('auth-status');
const logoutButton = document.getElementById('btn-logout');
const deleteForm = document.getElementById('delete-form');
const createUserForm = document.getElementById('cadastro-form');
const createUserButton = document.getElementById('btn-criar-usuario');
const createUserMessage = document.getElementById('create-user-message');
const loginPortal = document.getElementById('tela-login');
const loginMessage = document.getElementById('login-message');
const loginButton = document.getElementById('btn-login');
const appContainer = document.querySelector('.app-container');

inputCodigo.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || inputCodigo.value.trim() === '') return;

    const codigo = inputCodigo.value.trim();
    inputCodigo.value = 'Buscando...';
    inputCodigo.disabled = true;
    try {
        const resposta = await APIGateway.buscarProduto(codigo);
        if (resposta.status === 200) {
            adicionarAoCarrinho(resposta.data);
        } else {
            alert(resposta.message);
        }
    } finally {
        inputCodigo.value = '';
        inputCodigo.disabled = false;
        inputCodigo.focus();
    }
});

function adicionarAoCarrinho(produto) {
    carrinho.push({ ...produto, quantidade: 1 });
    const linha = document.createElement('div');
    linha.className = 'item-linha';
    const nome = document.createElement('span');
    nome.textContent = produto.nome;
    const preco = document.createElement('strong');
    preco.textContent = formatarMoeda(produto.preco);
    linha.append(nome, preco);
    listaItens.appendChild(linha);
    atualizarTotais();
}

function atualizarTotais() {
    const total = carrinho.reduce((soma, produto) => soma + produto.preco * produto.quantidade, 0);
    subtotalUI.textContent = formatarMoeda(total);
    totalUI.textContent = formatarMoeda(total);
}

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

document.querySelectorAll('.btn-pagamento').forEach((button) => {
    button.addEventListener('click', () => {
        metodoPagamento = button.dataset.tipo;
        document.querySelectorAll('.btn-pagamento').forEach((item) => item.classList.remove('selected'));
        button.classList.add('selected');
    });
});

async function finalizarVenda() {
    if (carrinho.length === 0) return alert("Carrinho vazio!");
    checkoutButton.disabled = true;
    try {
        const recibo = await APIGateway.registrarVenda(carrinho, metodoPagamento);
        gerarReciboPDF(recibo);
        alert(`Venda finalizada! Recibo: ${recibo.reciboId}`);
        carrinho = [];
        listaItens.replaceChildren();
        atualizarTotais();
    } catch (error) {
        alert(error.message);
    } finally {
        checkoutButton.disabled = false;
    }
}

function gerarReciboPDF(recibo) {
    const { jsPDF } = window.jspdf;
    const documento = new jsPDF();
    let y = 20;

    documento.setFontSize(18);
    documento.text('Comprovante de venda', 15, y);
    y += 10;
    documento.setFontSize(10);
    documento.text(`Venda: ${recibo.reciboId}`, 15, y);
    y += 6;
    documento.text(`Data: ${new Date().toLocaleString('pt-BR')}`, 15, y);
    y += 6;
    documento.text(`Pagamento: ${recibo.metodoPagamento}`, 15, y);
    y += 10;
    documento.line(15, y, 195, y);
    y += 8;

    recibo.itens.forEach((item) => {
        if (y > 270) {
            documento.addPage();
            y = 20;
        }
        documento.text(`${item.quantidade}x ${item.nome}`.substring(0, 48), 15, y);
        documento.text(formatarMoeda(item.preco * item.quantidade), 195, y, { align: 'right' });
        y += 7;
    });

    y += 3;
    documento.line(15, y, 195, y);
    documento.setFontSize(13);
    documento.text(`Total: ${formatarMoeda(recibo.total)}`, 15, y + 9);
    documento.save(`recibo-${recibo.reciboId}.pdf`);
}

// A interface delega autenticação e consulta de role ao módulo Gateway.
loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    loginButton.disabled = true;
    loginMessage.textContent = 'Verificando acesso...';
    loginMessage.classList.remove('is-error');

    try {
        const profile = await APIGateway.login(email, password);
        renderAuthenticatedUser(profile);
        loginForm.reset();
    } catch (error) {
        loginMessage.textContent = error.message || 'Não foi possível entrar. Confira seus dados.';
        loginMessage.classList.add('is-error');
    } finally {
        loginButton.disabled = false;
    }
});

logoutButton.addEventListener('click', async () => {
    await firebase.auth().signOut();
});

function renderAuthenticatedUser(profile) {
    currentRole = profile.role;
    loginPortal.hidden = true;
    appContainer.hidden = false;
    authStatus.textContent = `${profile.nome || profile.user?.displayName || profile.user?.email || profile.email} · ${profile.role}`;
    logoutButton.hidden = false;

    document.querySelectorAll('.nav-btn').forEach((button) => {
        const roles = button.dataset.roles.split(',');
        button.hidden = !roles.includes(currentRole);
        button.classList.remove('active');
    });

    // Admin pode alternar entre todos os setores; funcionário abre somente sua área.
    activateScreen(roleHome[currentRole]);
}

function activateScreen(screenId) {
    const screen = document.getElementById(screenId);
    if (!screen || !currentRole) return;

    const navButton = document.querySelector(`.nav-btn[data-target="${screenId}"]`);
    if (!navButton || navButton.hidden) return;

    document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach((section) => section.classList.remove('active'));
    navButton.classList.add('active');
    screen.classList.add('active');
}

// Revalida o perfil ao restaurar uma sessão já autenticada no navegador.
firebase.auth().onAuthStateChanged(async (user) => {
    const stateVersion = ++authStateVersion;
    if (!user) {
        currentRole = null;
        appContainer.hidden = true;
        loginPortal.hidden = false;
        authStatus.textContent = '';
        logoutButton.hidden = true;
        document.querySelectorAll('.view-section').forEach((section) => section.classList.remove('active'));
        return;
    }

    appContainer.hidden = true;
    loginPortal.hidden = false;
    loginMessage.textContent = 'Carregando seu setor...';
    try {
        const profile = await APIGateway.obterPerfil(user.uid);
        if (stateVersion === authStateVersion) {
            renderAuthenticatedUser({ ...profile, user });
            loginMessage.textContent = '';
        }
    } catch (error) {
        if (stateVersion !== authStateVersion) return;
        loginMessage.textContent = error.message;
        loginMessage.classList.add('is-error');
        await firebase.auth().signOut();
    }
});

deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const productId = document.getElementById('produto-id').value.trim();
    if (!productId || !confirm(`Excluir o produto ${productId}?`)) return;
    try {
        const result = await APIGateway.excluirProduto(productId);
        authStatus.textContent = result.message;
        deleteForm.reset();
    } catch (error) {
        authStatus.textContent = error.message;
    }
});

// O navegador envia os dados pelo Gateway, mas não cria nem autentica a nova conta.
createUserForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(createUserForm);
    const funcionario = {
        nome: formData.get('nome').trim(),
        email: formData.get('email').trim(),
        senha: formData.get('senha'),
        role: formData.get('role')
    };

    createUserButton.disabled = true;
    createUserMessage.textContent = 'Cadastrando funcionário...';
    createUserMessage.classList.remove('is-error');
    try {
        const result = await APIGateway.criarUsuario(funcionario);
        createUserForm.reset();
        createUserMessage.textContent = `${result.message} O acesso foi criado sem encerrar sua sessão.`;
        authStatus.textContent = result.message;
        alert(result.message);
    } catch (error) {
        createUserMessage.textContent = error.message || 'Não foi possível cadastrar o funcionário.';
        createUserMessage.classList.add('is-error');
        authStatus.textContent = createUserMessage.textContent;
    } finally {
        createUserButton.disabled = false;
    }
});

document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
        const allowedRoles = button.dataset.roles.split(',');
        if (!currentRole || !allowedRoles.includes(currentRole)) {
            event.preventDefault();
            return;
        }
        activateScreen(button.dataset.target);
    });
});