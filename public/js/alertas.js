// Modulo compartido: "alerta persistente" — un aviso bien visible que se
// queda en pantalla hasta que la persona lo cierra a mano (a diferencia del
// toast normal, que desaparece solo a los pocos segundos). Se usa tanto en
// el panel de administracion (pedido nuevo / cambio de estado) como en la
// tienda del cliente (cambio de estado de su propio pedido).
//
// Requiere un contenedor <div id="alertas"></div> en la pagina. Se carga
// ANTES que el script propio de cada pagina (admin.js, pedidos.js, etc.).

window.Alertas = (function () {
  'use strict';

  function mostrar(mensaje, tipo) {
    const contenedor = document.getElementById('alertas');
    if (!contenedor) return; // la pagina no tiene el contenedor — no rompemos nada

    const alerta = document.createElement('div');
    alerta.className = `alerta alerta--${tipo || 'info'}`;
    alerta.setAttribute('role', 'alert');

    const texto = document.createElement('p');
    texto.className = 'alerta__texto';
    texto.textContent = mensaje;

    const btnCerrar = document.createElement('button');
    btnCerrar.type = 'button';
    btnCerrar.className = 'alerta__cerrar';
    btnCerrar.setAttribute('aria-label', 'Cerrar aviso');
    btnCerrar.textContent = '×';
    btnCerrar.addEventListener('click', () => alerta.remove());

    alerta.append(texto, btnCerrar);
    contenedor.prepend(alerta);
  }

  return { mostrar };
})();
