from flask import Flask, render_template, request, jsonify
import redis
import json
import requests
from bs4 import BeautifulSoup
import smtplib
from email.mime.text import MIMEText
import os
import logging

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static')

# Configuração do Redis
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')
logger.info(f"Conectando ao Redis: {REDIS_URL}")

try:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    logger.info("Conexão com Redis estabelecida com sucesso")
except Exception as e:
    logger.error(f"Erro ao conectar com Redis: {str(e)}")
    redis_client = None

# Configuração do Email
EMAIL_USER = "emailapostavip@gmail.com"
EMAIL_PASSWORD = "dafi rlkj iamv olvu"

def enviar_email(destinatario, produto, preco_atual, preco_desejado, url):
    try:
        msg = MIMEText(f"""
        Olá! O produto que você está monitorando atingiu o preço desejado!

        Produto: {produto}
        Preço Atual: R$ {preco_atual:.2f}
        Preço Desejado: R$ {preco_desejado:.2f}
        URL: {url}

        Aproveite!
        """)
        
        msg['Subject'] = f'Alerta de Preço: {produto}'
        msg['From'] = EMAIL_USER
        msg['To'] = destinatario

        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(EMAIL_USER, EMAIL_PASSWORD)
            smtp.send_message(msg)
        return True
    except Exception as e:
        logging.error(f"Erro ao enviar email: {str(e)}")
        return False

def extrair_preco(url):
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Amazon
        if 'amazon.com.br' in url:
            preco_element = soup.find('span', {'class': 'a-offscreen'})
            if preco_element:
                preco_text = preco_element.text.strip()
                return float(preco_text.replace('R$', '').replace('.', '').replace(',', '.'))
        
        # Mercado Livre
        elif 'mercadolivre' in url:
            preco_element = soup.find('span', {'class': 'andes-money-amount__fraction'})
            if preco_element:
                preco_text = preco_element.text.strip()
                return float(preco_text.replace('.', ''))
        
        # Kabum
        elif 'kabum' in url:
            preco_element = soup.find('h4', {'class': 'finalPrice'})
            if preco_element:
                preco_text = preco_element.text.strip()
                return float(preco_text.replace('R$', '').replace('.', '').replace(',', '.'))
        
        # Magalu
        elif 'magazineluiza' in url or 'magalu' in url:
            preco_element = soup.find('p', {'class': 'price-template__text'})
            if preco_element:
                preco_text = preco_element.text.strip()
                return float(preco_text.replace('R$', '').replace('.', '').replace(',', '.'))
        
        logger.error(f"Não foi possível encontrar o preço para a URL: {url}")
        return None
        
    except Exception as e:
        logger.error(f"Erro ao extrair preço da URL {url}: {str(e)}")
        return None

def get_client_ip():
    """Obtém o IP real do cliente mesmo atrás de proxy"""
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0]
    return request.remote_addr

def get_user_key(prefix):
    """Gera uma chave única para o usuário baseada no IP"""
    ip = get_client_ip()
    return f"{prefix}:{ip}"

@app.route('/')
def home():
    try:
        # Usar chaves específicas para cada IP
        email_key = get_user_key('email')
        produtos_key = get_user_key('produtos')
        
        email = redis_client.get(email_key)
        produtos = json.loads(redis_client.get(produtos_key) or '[]')
        
        return render_template('index.html', 
                             email_destinatario=email, 
                             produtos=produtos)
    except Exception as e:
        logging.error(f"Erro na página inicial: {str(e)}")
        return str(e), 500

@app.route('/atualizar_email', methods=['POST'])
def atualizar_email():
    try:
        email = request.form.get('email')
        if not email:
            return jsonify({"success": False, "message": "Email não fornecido"})
        
        # Salvar email com chave específica do IP
        email_key = get_user_key('email')
        redis_client.set(email_key, email)
        
        return jsonify({
            "success": True,
            "message": "Email atualizado com sucesso!"
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

@app.route('/adicionar_produto', methods=['POST'])
def adicionar_produto():
    try:
        nome = request.form.get('nome')
        url = request.form.get('url')
        preco_str = request.form.get('preco_desejado')
        
        try:
            preco_desejado = float(preco_str.replace(',', '.'))
        except ValueError:
            return jsonify({"success": False, "message": "Preço inválido"}), 400
        
        # Usar chave específica do IP
        produtos_key = get_user_key('produtos')
        produtos = json.loads(redis_client.get(produtos_key) or '[]')
        
        produtos.append({
            "nome": nome,
            "url": url,
            "preco_desejado": preco_desejado
        })
        
        redis_client.set(produtos_key, json.dumps(produtos))
        
        return jsonify({
            "success": True,
            "message": "Produto adicionado com sucesso!"
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

@app.route('/remover_produto', methods=['POST'])
def remover_produto():
    try:
        index = int(request.form.get('index'))
        
        # Usar chave específica do IP
        produtos_key = get_user_key('produtos')
        produtos = json.loads(redis_client.get(produtos_key) or '[]')
        
        if 0 <= index < len(produtos):
            produtos.pop(index)
            redis_client.set(produtos_key, json.dumps(produtos))
            
            return jsonify({
                "success": True,
                "message": "Produto removido com sucesso!"
            })
        else:
            return jsonify({
                "success": False,
                "message": "Índice inválido"
            }), 400
            
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

@app.route('/iniciar_monitoramento', methods=['POST'])
def iniciar_monitoramento():
    try:
        # Usar chaves específicas do IP
        email_key = get_user_key('email')
        produtos_key = get_user_key('produtos')
        
        email = redis_client.get(email_key)
        if not email:
            return jsonify({
                "success": False,
                "message": "Email de contato não configurado!"
            })
        
        produtos = json.loads(redis_client.get(produtos_key) or '[]')
        resultados = []
        
        for produto in produtos:
            try:
                preco_atual = extrair_preco(produto['url'])
                
                if preco_atual is None:
                    resultados.append({
                        "nome": produto['nome'],
                        "status": "erro",
                        "mensagem": "Não foi possível extrair o preço"
                    })
                    continue
                
                if preco_atual <= produto['preco_desejado']:
                    enviar_email(
                        email,
                        produto['nome'],
                        preco_atual,
                        produto['preco_desejado'],
                        produto['url']
                    )
                    
                    resultados.append({
                        "nome": produto['nome'],
                        "status": "alerta_enviado",
                        "preco_atual": preco_atual,
                        "preco_desejado": produto['preco_desejado']
                    })
                else:
                    resultados.append({
                        "nome": produto['nome'],
                        "status": "monitorado",
                        "preco_atual": preco_atual,
                        "preco_desejado": produto['preco_desejado']
                    })
            except Exception as e:
                resultados.append({
                    "nome": produto['nome'],
                    "status": "erro",
                    "mensagem": str(e)
                })
        
        return jsonify({
            "success": True,
            "message": "Monitoramento concluído",
            "resultados": resultados
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True) 