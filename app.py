from flask import Flask, render_template, request, jsonify
from price_monitor import MonitorPrecos
import json

app = Flask(__name__)
monitor = MonitorPrecos()

@app.route('/')
def home():
    try:
        with open('config.json', 'r') as file:
            config = json.load(file)
    except FileNotFoundError:
        config = {"email_destinatario": "joaovitorroventini@gmail.com"}
        with open('config.json', 'w') as file:
            json.dump(config, file, indent=4)
    
    return render_template('index.html', 
                         monitor=monitor,
                         produtos=monitor.produtos,
                         email_destinatario=config.get('email_destinatario'))

@app.route('/adicionar_produto', methods=['POST'])
def adicionar_produto():
    try:
        dados = request.form
        novo_produto = {
            'nome': dados['nome'],
            'url': dados['url'],
            'preco_alvo': float(dados['preco_alvo'])
        }
        
        # Carrega produtos existentes
        try:
            with open('produtos.json', 'r') as file:
                produtos = json.load(file)
        except FileNotFoundError:
            produtos = []
        
        # Adiciona novo produto
        produtos.append(novo_produto)
        
        # Salva produtos atualizados
        with open('produtos.json', 'w') as file:
            json.dump(produtos, file, indent=4)
        
        # Atualiza a lista de produtos no monitor
        monitor.produtos = produtos
        
        return jsonify({'success': True, 'message': 'Produto adicionado com sucesso!'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Erro ao adicionar produto: {str(e)}'})

@app.route('/remover_produto', methods=['POST'])
def remover_produto():
    try:
        index = int(request.form['index'])
        
        with open('produtos.json', 'r') as file:
            produtos = json.load(file)
        
        if 0 <= index < len(produtos):
            produtos.pop(index)
            
            with open('produtos.json', 'w') as file:
                json.dump(produtos, file, indent=4)
            
            monitor.produtos = produtos
            return jsonify({'success': True, 'message': 'Produto removido com sucesso!'})
        else:
            return jsonify({'success': False, 'message': 'Índice inválido'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Erro ao remover produto: {str(e)}'})

@app.route('/iniciar_monitoramento', methods=['POST'])
def iniciar_monitoramento():
    try:
        resultados = monitor.monitorar()  # Assume que monitorar() retorna os resultados
        return jsonify({
            'success': True,
            'message': 'Monitoramento concluído!',
            'resultados': resultados,
            'total_verificados': len(monitor.produtos)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Erro ao iniciar monitoramento: {str(e)}'
        })

@app.route('/atualizar_email', methods=['POST'])
def atualizar_email():
    try:
        novo_email = request.form['email_destinatario']
        
        # Atualiza o email no monitor e no arquivo de configuração
        monitor.atualizar_email(novo_email)
        
        return jsonify({
            'success': True, 
            'message': 'Email atualizado com sucesso!'
        })
    except Exception as e:
        return jsonify({
            'success': False, 
            'message': f'Erro ao atualizar email: {str(e)}'
        })

if __name__ == '__main__':
    app.run(debug=True) 