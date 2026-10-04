const APIGateway = {
    // Autentica no Firebase e carrega a role usada pelo roteamento visual.
    async login(email, senha) {
        const credential = await firebase.auth().signInWithEmailAndPassword(email, senha);
        try {
            const profile = await this.obterPerfil(credential.user.uid);
            return { user: credential.user, ...profile };
        } catch (error) {
            await firebase.auth().signOut();
            throw error;
        }
    },

    // O documento usuarios/{uid} deve conter uma role reconhecida pelo frontend.
    async obterPerfil(uid) {
        const snapshot = await firebase.firestore().collection('usuarios').doc(uid).get();
        if (!snapshot.exists) throw new Error('Perfil não encontrado na coleção usuarios.');

        const profile = snapshot.data();
        const allowedRoles = ['operador_caixa', 'operador_estoque', 'gerente_vendas', 'admin'];
        if (!allowedRoles.includes(profile.role)) throw new Error('O perfil não possui um cargo válido.');

        return { uid, role: profile.role, nome: profile.nome || '' };
    },

    async request(path, options = {}) {
        try {
            const response = await fetch(path, {
                ...options,
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(data.message || 'Falha ao falar com o Gateway.');
                error.status = response.status;
                throw error;
            }
            return data;
        } catch (error) {
            throw error;
        }
    },

    async buscarProduto(codigo) {
        try {
            const data = await this.request(`/api/produtos/${encodeURIComponent(codigo)}`);
            return { status: 200, data };
        } catch (error) {
            return { status: error.status || 500, message: error.message };
        }
    },

    async registrarVenda(carrinho, metodo) {
        return this.request('/api/vendas/processar', {
            method: 'POST',
            body: JSON.stringify({
                itens: carrinho.map((produto) => ({ productId: produto.id, quantidade: produto.quantidade || 1 })),
                metodoPagamento: metodo
            })
        });
    },

    async excluirProduto(productId) {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('Entre com sua conta antes de excluir um produto.');

        const token = await user.getIdToken();
        return this.request(`/api/produtos/${encodeURIComponent(productId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });
    },

    // Envia o token do Admin ao backend; a conta é criada pelo Admin SDK,
    // evitando que o Firebase Auth troque a sessão ativa do navegador.
    async criarUsuario(dadosUsuario) {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('Sua sessão expirou. Entre novamente como administrador.');

        const token = await user.getIdToken();
        return this.request('/api/usuarios', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                nome: dadosUsuario.nome,
                email: dadosUsuario.email,
                senha: dadosUsuario.senha,
                role: dadosUsuario.role
            })
        });
    }
};