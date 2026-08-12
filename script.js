// ===============================
// NEXUS SYSTEM
// ===============================

const cursor = document.querySelector(".cursor-glow");
const menuButton = document.getElementById("menuButton");
const nav = document.getElementById("nav");

// Cursor luminoso
document.addEventListener("mousemove", (event) => {

    if (!cursor) return;

    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;

});


// Menu mobile
if (menuButton && nav) {

    menuButton.addEventListener("click", () => {
        nav.classList.toggle("open");

        menuButton.textContent =
            nav.classList.contains("open") ? "×" : "☰";
    });

}


// Fechar menu ao clicar em um link
if (nav) {

    nav.querySelectorAll("a").forEach(link => {

        link.addEventListener("click", () => {
            nav.classList.remove("open");

            if (menuButton) {
                menuButton.textContent = "☰";
            }
        });

    });

}


// Links internos com scroll suave
document.querySelectorAll('a[href^="#"]').forEach(link => {

    link.addEventListener("click", event => {

        const targetId = link.getAttribute("href");

        if (targetId === "#") return;

        const target = document.querySelector(targetId);

        if (!target) return;

        event.preventDefault();

        target.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    });

});


// Ativar item da navegação conforme a seção
const sections = document.querySelectorAll("section[id]");
const navLinks = document.querySelectorAll("nav a");

const observer = new IntersectionObserver(
    entries => {

        entries.forEach(entry => {

            if (!entry.isIntersecting) return;

            navLinks.forEach(link => {
                link.classList.remove("active");
            });

            const activeLink = document.querySelector(
                `nav a[href="#${entry.target.id}"]`
            );

            if (activeLink) {
                activeLink.classList.add("active");
            }

        });

    },
    {
        threshold: 0.45
    }
);

sections.forEach(section => observer.observe(section));


// Pequeno efeito de entrada nos cards
const cards = document.querySelectorAll(
    ".tech-card, .resource-item"
);

const cardObserver = new IntersectionObserver(
    entries => {

        entries.forEach(entry => {

            if (entry.isIntersecting) {

                entry.target.style.opacity = "1";
                entry.target.style.transform = "translateY(0)";

            }

        });

    },
    {
        threshold: 0.15
    }
);

cards.forEach(card => {

    card.style.opacity = "0";
    card.style.transform = "translateY(30px)";
    card.style.transition =
        "opacity .7s ease, transform .7s ease";

    cardObserver.observe(card);

});
