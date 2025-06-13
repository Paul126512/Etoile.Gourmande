document.addEventListener('DOMContentLoaded', function () {
    const burgerMenu = document.getElementById('burger-menu');
    const navList = document.querySelector('nav ul');

    burgerMenu.addEventListener('click', function () {
        burgerMenu.classList.toggle('active');
        navList.classList.toggle('active');
    });
});
