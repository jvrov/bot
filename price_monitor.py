import requests
from bs4 import BeautifulSoup
import time
import yagmail
import json
from datetime import datetime
import smtplib
from email.mime.text import MIMEText

class MonitorPrecos:
    def __init__(self):
        # Headers para simular um navegador
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        # Carregar produtos do arquivo de configuração
        self.produtos = self.carregar_produtos()
        self.email_destinatario = self.carregar_config()['email_destinatario']

    def carregar_produtos(self):
        try:
            with open('produtos.json', 'r') as file:
                return json.load(file)
        except FileNotFoundError:
            return []

    def carregar_config(self):
        try:
            with open('config.json', 'r') as file:
                return json.load(file)
        except FileNotFoundError:
            config = {"email_destinatario": "joaovitorroventini@gmail.com"}
            with open('config.json', 'w') as file:
                json.dump(config, file, indent=4)
            return config

    def atualizar_email(self, novo_email):
        self.email_destinatario = novo_email
        config = self.carregar_config()
        config['email_destinatario'] = novo_email
        with open('config.json', 'w') as file:
            json.dump(config, file, indent=4)

    def verificar_preco(self, url):
        try:
            print(f"- Acessando URL: {url}")
            pagina = requests.get(url, headers=self.headers)
            print(f"- Status da requisicao: {pagina.status_code}")
            
            soup = BeautifulSoup(pagina.content, 'html.parser')
            preco = None

            # Amazon
            if "amazon.com.br" in url:
                elemento = soup.find('span', class_='a-offscreen')
                if elemento:
                    preco = float(elemento.text.replace('R$', '').replace('.', '').replace(',', '.').strip())

            # Magalu
            elif "magazineluiza.com.br" in url:
                elemento = soup.find('p', {'data-testid': 'price-value'})
                if elemento:
                    preco = float(elemento.text.replace('R$', '').replace('.', '').replace(',', '.').strip())

            # Kabum
            elif "kabum.com.br" in url:
                elemento = soup.find('h4', class_='finalPrice')
                if elemento:
                    preco = float(elemento.text.replace('R$', '').replace('.', '').replace(',', '.').strip())

            # Mercado Livre
            elif "mercadolivre.com.br" in url:
                elemento = soup.find('span', class_='andes-money-amount__fraction')
                if elemento:
                    preco = float(elemento.text.replace('.', '').replace(',', '.').strip())

            if preco:
                print(f"- Preco encontrado: R${preco}")
                return preco
            else:
                print("- Elemento de preco nao encontrado na pagina")
                return None
            
        except Exception as e:
            print(f"- Erro ao verificar preco: {str(e)}")
            return None

    def enviar_email(self, produto, preco_atual):
        print("\n=== INICIANDO ENVIO DE EMAIL ===")
        
        EMAIL_REMETENTE = "emailapostavip@gmail.com"
        EMAIL_SENHA = "idfl phna hueu tnkh"
        EMAIL_DESTINATARIO = self.email_destinatario

        msg = MIMEText(
            f"O produto {produto['nome']} atingiu o preço desejado!\n"
            f"Preço atual: R${preco_atual}\n"
            f"Preço alvo: R${produto['preco_alvo']}\n"
            f"Link: {produto['url']}"
        )
        msg['Subject'] = 'Alerta de Preço!'
        msg['From'] = EMAIL_REMETENTE
        msg['To'] = EMAIL_DESTINATARIO

        try:
            print("- Conectando ao servidor Gmail...")
            # Primeiro tenta conexão direta
            server = smtplib.SMTP('smtp.gmail.com', 587, timeout=10)
            server.ehlo()
            server.starttls()
            server.ehlo()
            
            print("- Fazendo login...")
            server.login(EMAIL_REMETENTE, EMAIL_SENHA)
            
            print("- Enviando email...")
            server.send_message(msg)
            server.quit()
            print("* Email enviado com sucesso!")
            
        except TimeoutError:
            print("- Timeout na primeira tentativa, tentando método alternativo...")
            try:
                # Segunda tentativa usando SSL direto
                server = smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=10)
                server.login(EMAIL_REMETENTE, EMAIL_SENHA)
                server.send_message(msg)
                server.quit()
                print("* Email enviado com sucesso na segunda tentativa!")
                
            except Exception as e:
                print(f"X ERRO na segunda tentativa: {str(e)}")
                raise
            
        except Exception as e:
            print(f"X ERRO ao enviar email: {str(e)}")
            print("   Detalhes do erro:", e.__class__.__name__)
        
        finally:
            print("=== PROCESSO DE EMAIL FINALIZADO ===\n")

    def monitorar(self):
        resultados = []
        print("\n=== INICIANDO MONITORAMENTO ===")
        
        for produto in self.produtos:
            try:
                preco_atual = self.verificar_preco(produto['url'])
                if preco_atual and preco_atual <= produto['preco_alvo']:
                    self.enviar_email(produto, preco_atual)
                    resultados.append({
                        'nome': produto['nome'],
                        'preco_atual': preco_atual,
                        'preco_alvo': produto['preco_alvo'],
                        'status': 'alerta_enviado'
                    })
                else:
                    resultados.append({
                        'nome': produto['nome'],
                        'preco_atual': preco_atual,
                        'preco_alvo': produto['preco_alvo'],
                        'status': 'verificado'
                    })
            except Exception as e:
                print(f"Erro ao monitorar {produto['nome']}: {str(e)}")
                resultados.append({
                    'nome': produto['nome'],
                    'status': 'erro',
                    'erro': str(e)
                })
        
        print("=== MONITORAMENTO FINALIZADO ===\n")
        return resultados

def testar_email():
    EMAIL_REMETENTE = "emailapostavip@gmail.com"
    EMAIL_SENHA = "idfl phna hueu tnkh"
    EMAIL_DESTINATARIO = "joaovitorroventini@gmail.com"

    msg = MIMEText("Este é um email de teste do bot de preços!")
    msg['Subject'] = 'Teste do Bot de Preços'
    msg['From'] = EMAIL_REMETENTE
    msg['To'] = EMAIL_DESTINATARIO

    try:
        print("- Conectando ao servidor Gmail...")
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp_server:
            print("- Tentando fazer login...")
            smtp_server.login(EMAIL_REMETENTE, EMAIL_SENHA)
            print("- Login realizado com sucesso!")
            
            print("- Enviando email...")
            smtp_server.sendmail(EMAIL_REMETENTE, EMAIL_DESTINATARIO, msg.as_string())
            print("* Email enviado com sucesso!")
            
    except Exception as e:
        print(f"ERRO: {str(e)}")

if __name__ == "__main__":
    monitor = MonitorPrecos()
    monitor.monitorar()
    testar_email() 