import smtplib
from email.mime.text import MIMEText

def testar_email():
    EMAIL_REMETENTE = "emailapostavip@gmail.com"
    EMAIL_SENHA = "hoffynndhrqujlef"
    EMAIL_DESTINATARIO = "jv.roventini@gmail.com"

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
    testar_email() 