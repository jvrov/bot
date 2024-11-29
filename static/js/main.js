// Funções de Loading
function showLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// Funções de Tema
function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon();
}

function updateThemeIcon() {
    const themeIcon = document.querySelector('.theme-switch i');
    const currentTheme = document.body.getAttribute('data-theme') || 'light';
    if (themeIcon) {
        themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
}

// Função de Alerta
function showAlert(title, text, icon) {
    Swal.fire({
        title: title,
        text: text,
        icon: icon,
        confirmButtonColor: '#2563eb'
    });
}

// Atualiza o horário da última atualização
function updateLastUpdate() {
    const now = new Date();
    const options = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    const timeString = now.toLocaleString('pt-BR', options);
    document.getElementById('lastUpdate').textContent = timeString;
}

// Quando o documento estiver carregado
document.addEventListener('DOMContentLoaded', function() {
    // Inicializar tema
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeIcon();

    // Form de Email
    const formEmail = document.getElementById('formEmail');
    if (formEmail) {
        formEmail.addEventListener('submit', function(e) {
            e.preventDefault();
            showLoading();

            const formData = new FormData();
            formData.append('email', document.getElementById('email').value);

            fetch('/atualizar_email', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                hideLoading();
                if (data.success) {
                    showAlert('Sucesso!', data.message, 'success');
                } else {
                    showAlert('Erro!', data.message, 'error');
                }
            })
            .catch(error => {
                hideLoading();
                showAlert('Erro!', 'Ocorreu um erro ao atualizar o email.', 'error');
            });
        });
    }

    // Form de Produto
    const formProduto = document.getElementById('formProduto');
    if (formProduto) {
        formProduto.addEventListener('submit', function(e) {
            e.preventDefault();
            showLoading();

            const formData = new FormData();
            formData.append('nome', document.getElementById('nome').value);
            formData.append('url', document.getElementById('url').value);
            formData.append('preco_desejado', document.getElementById('preco_desejado').value);

            fetch('/adicionar_produto', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                hideLoading();
                if (data.success) {
                    showAlert('Sucesso!', data.message, 'success');
                    location.reload(); // Recarrega para mostrar o novo produto
                } else {
                    showAlert('Erro!', data.message, 'error');
                }
            })
            .catch(error => {
                hideLoading();
                showAlert('Erro!', 'Ocorreu um erro ao adicionar o produto.', 'error');
            });
        });
    }

    // Chamar a função quando a página carregar
    updateLastUpdate();
    // Atualizar a cada minuto
    setInterval(updateLastUpdate, 60000);
});

// Função de Monitoramento com animação
function iniciarMonitoramento() {
    // Primeiro alerta - Iniciando monitoramento
    Swal.fire({
        title: 'Monitorando produtos',
        html: '<div class="text-center"><i class="fas fa-search fa-spin fa-2x mb-3"></i><br>Verificando preços...</div>',
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => {
            fetch('/iniciar_monitoramento', {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    mostrarResultados(data.resultados);
                } else {
                    Swal.fire('Erro!', data.message, 'error');
                }
            })
            .catch(error => {
                Swal.fire('Erro!', 'Ocorreu um erro ao monitorar os produtos.', 'error');
            });
        }
    });
}

// Função para mostrar resultados com animação
function mostrarResultados(resultados) {
    let alertasEnviados = resultados.filter(r => r.status === 'alerta_enviado');
    let monitorados = resultados.filter(r => r.status === 'monitorado');
    let erros = resultados.filter(r => r.status === 'erro');

    let html = `
        <div class="resultado-monitoramento">
            <div class="mb-4">
                <h5 class="mb-3 text-success">
                    <i class="fas fa-bell me-2"></i>
                    Alertas Enviados (${alertasEnviados.length})
                </h5>
                ${alertasEnviados.map(produto => `
                    <div class="alert alert-success mb-2 text-start">
                        <strong>${produto.nome}</strong><br>
                        <small>Preço Atual: R$ ${produto.preco_atual.toFixed(2)}</small><br>
                        <small>Preço Desejado: R$ ${produto.preco_desejado.toFixed(2)}</small>
                    </div>
                `).join('')}
            </div>

            <div class="mb-4">
                <h5 class="mb-3 text-primary">
                    <i class="fas fa-clock me-2"></i>
                    Monitorando (${monitorados.length})
                </h5>
                ${monitorados.map(produto => `
                    <div class="alert alert-primary mb-2 text-start">
                        <strong>${produto.nome}</strong><br>
                        <small>Preço Atual: R$ ${produto.preco_atual.toFixed(2)}</small><br>
                        <small>Preço Desejado: R$ ${produto.preco_desejado.toFixed(2)}</small>
                    </div>
                `).join('')}
            </div>

            ${erros.length > 0 ? `
                <div class="mb-4">
                    <h5 class="mb-3 text-danger">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Erros (${erros.length})
                    </h5>
                    ${erros.map(produto => `
                        <div class="alert alert-danger mb-2 text-start">
                            <strong>${produto.nome}</strong><br>
                            <small>${produto.mensagem}</small>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <div class="text-center mt-4">
                <div class="row">
                    <div class="col-4">
                        <h3 class="text-success">${alertasEnviados.length}</h3>
                        <small class="text-muted">Alertas</small>
                    </div>
                    <div class="col-4">
                        <h3 class="text-primary">${monitorados.length}</h3>
                        <small class="text-muted">Monitorados</small>
                    </div>
                    <div class="col-4">
                        <h3 class="text-danger">${erros.length}</h3>
                        <small class="text-muted">Erros</small>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Mostrar resultados com animação
    Swal.fire({
        title: 'Monitoramento Concluído!',
        html: html,
        icon: 'success',
        width: '600px',
        showConfirmButton: true,
        confirmButtonText: 'OK',
        confirmButtonColor: '#2563eb',
        allowOutsideClick: false,
        didOpen: (modal) => {
            // Adicionar animação de entrada para cada alerta
            const alerts = modal.querySelectorAll('.alert');
            alerts.forEach((alert, index) => {
                alert.style.opacity = '0';
                alert.style.transform = 'translateX(-20px)';
                alert.style.transition = 'all 0.3s ease';
                
                setTimeout(() => {
                    alert.style.opacity = '1';
                    alert.style.transform = 'translateX(0)';
                }, 100 * (index + 1));
            });
        }
    }).then((result) => {
        if (result.isConfirmed) {
            location.reload();
        }
    });
}

// Função de Remover Produto
function removerProduto(index) {
    Swal.fire({
        title: 'Tem certeza?',
        text: "Você não poderá reverter esta ação!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Sim, remover!',
        cancelButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            showLoading();
            const formData = new FormData();
            formData.append('index', index);
            
            fetch('/remover_produto', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                hideLoading();
                if (data.success) {
                    showAlert('Removido!', data.message, 'success');
                    location.reload();
                } else {
                    showAlert('Erro!', data.message, 'error');
                }
            })
            .catch(error => {
                hideLoading();
                showAlert('Erro!', 'Ocorreu um erro ao remover o produto.', 'error');
            });
        }
    });
}

// Função de Ver Histórico (placeholder)
function verHistorico(index) {
    showAlert('Em desenvolvimento', 'Função de histórico será implementada em breve!', 'info');
}

// Função para adicionar produto
function adicionarProduto() {
    const form = document.getElementById('formProduto');
    const formData = new FormData(form);

    // Validar formulário
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    showLoading();

    fetch('/adicionar_produto', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        hideLoading();
        if (data.success) {
            // Fechar modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('addProductModal'));
            modal.hide();
            
            // Limpar formulário
            form.reset();
            
            // Mostrar mensagem de sucesso
            Swal.fire({
                title: 'Sucesso!',
                text: data.message,
                icon: 'success',
                confirmButtonColor: '#2563eb'
            }).then(() => {
                // Recarregar página
                location.reload();
            });
        } else {
            Swal.fire({
                title: 'Erro!',
                text: data.message,
                icon: 'error',
                confirmButtonColor: '#2563eb'
            });
        }
    })
    .catch(error => {
        hideLoading();
        Swal.fire({
            title: 'Erro!',
            text: 'Ocorreu um erro ao adicionar o produto.',
            icon: 'error',
            confirmButtonColor: '#2563eb'
        });
    });
}

// Adicionar estilos para o tema escuro no modal
document.addEventListener('DOMContentLoaded', function() {
    const body = document.body;
    const currentTheme = localStorage.getItem('theme') || 'light';
    if (currentTheme === 'dark') {
        body.setAttribute('data-theme', 'dark');
    }
});