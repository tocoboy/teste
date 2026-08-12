const progress = document.querySelector(".progress");
const percentage = document.getElementById("percentage");
const status = document.getElementById("status");

const messages = [
    "Inicializando sistema...",
    "Carregando módulos...",
    "Estabelecendo conexão...",
    "Verificando segurança...",
    "Sincronizando dados...",
    "Preparando interface...",
    "Quase pronto..."
];

let value = 0;
let messageIndex = 0;

const loading = setInterval(() => {

    // Velocidade variável para deixar o carregamento mais natural
    const increment = Math.random() * 2 + 0.5;

    value += increment;

    if (value >= 100) {
        value = 100;
        clearInterval(loading);

        status.textContent = "Sistema pronto.";

        setTimeout(() => {
            console.log("Loading concluído!");

            // Caso queira redirecionar:
            // window.location.href = "home.html";

        }, 800);
    }

    progress.style.width = `${value}%`;
    percentage.textContent = `${Math.floor(value)}%`;

    // Troca a mensagem conforme o progresso
    const newIndex = Math.min(
        Math.floor(value / (100 / messages.length)),
        messages.length - 1
    );

    if (newIndex !== messageIndex) {
        messageIndex = newIndex;
        status.textContent = messages[messageIndex];
    }

}, 100);
