// Ayuda contextual del panel (admin/HelpTip.jsx): globos «?» y guías completas
// escritas para quien nunca ha trabajado en una óptica ni sabe optometría.
// Cada tema tiene: title, short (globo, 1–2 frases), what, how (pasos), why y,
// opcionales, example y pitfalls. Se aplanan a `adm.help.<tema>.<campo>`; los
// pasos y los errores frecuentes van separados por "\n" (HelpTip los lista).
// Español primero; inglés con las mismas claves.

const UI = {
  es: {
    "adm.help.ui.button": "Ayuda",
    "adm.help.ui.more": "Ver guía completa",
    "adm.help.ui.close": "Cerrar la ayuda",
    "adm.help.ui.guide": "Guía",
    "adm.help.ui.what": "Qué es",
    "adm.help.ui.how": "Cómo se hace",
    "adm.help.ui.why": "Por qué importa",
    "adm.help.ui.example": "Ejemplo",
    "adm.help.ui.pitfalls": "Errores frecuentes",
    "adm.help.ui.related": "Temas relacionados",
    "adm.help.ui.missing": "Todavía no hay guía para este tema.",
    "adm.help.ui.whatCalc": "Qué es y cómo se calcula",
    "adm.help.ui.formula": "Fórmula",
    "adm.help.ui.usedIn": "Dónde se usa",
    "adm.help.ui.gotIt": "Entendido",
    "adm.help.group.rx": "La receta",
    "adm.help.group.sale": "Hacer una venta",
    "adm.help.group.exec": "Panel ejecutivo",
    "adm.help.group.cash": "Caja",
    "adm.help.group.reports": "Informes",
    "adm.help.group.setup": "Configuración",
    "adm.help.group.pricing": "Precios",
  },
  en: {
    "adm.help.ui.button": "Help",
    "adm.help.ui.more": "Open the full guide",
    "adm.help.ui.close": "Close help",
    "adm.help.ui.guide": "Guide",
    "adm.help.ui.what": "What it is",
    "adm.help.ui.how": "How to do it",
    "adm.help.ui.why": "Why it matters",
    "adm.help.ui.example": "Example",
    "adm.help.ui.pitfalls": "Common mistakes",
    "adm.help.ui.related": "Related topics",
    "adm.help.ui.missing": "There is no guide for this topic yet.",
    "adm.help.ui.whatCalc": "What it is and how it is calculated",
    "adm.help.ui.formula": "Formula",
    "adm.help.ui.usedIn": "Where it is used",
    "adm.help.ui.gotIt": "Got it",
    "adm.help.group.rx": "The prescription",
    "adm.help.group.sale": "Making a sale",
    "adm.help.group.exec": "Executive panel",
    "adm.help.group.cash": "Cash till",
    "adm.help.group.reports": "Reports",
    "adm.help.group.setup": "Settings",
    "adm.help.group.pricing": "Prices",
  },
};

const TOPICS_ES = {
  /* ─────────────── La receta ─────────────── */
  "pos.rx.howToRead": {
    title: "Cómo leer una receta en papel",
    short: "La receta tiene dos filas (OD = ojo derecho, OI = ojo izquierdo) y columnas con números. Copia cada número en la casilla con el mismo nombre.",
    what: "La receta es la nota del oculista con la «graduación» de cada ojo: cuánto hay que corregir la vista. Siempre tiene dos filas, una por ojo: OD (ojo derecho, a veces «R» u «O.D.») y OI u OS (ojo izquierdo, «L», «O.S.»). Las columnas suelen llamarse ESF (esfera), CIL (cilindro), EJE, ADD (adición) y a veces DNP/DIP y ALT. Esta pantalla usa los mismos nombres para que sea copiar.",
    how: [
      "Busca la fecha de la receta y escríbela en «Fecha»: una receta de más de 1–2 años (según el estado) ya no sirve para hacer lentes.",
      "Localiza la fila OD (derecho) y copia, de izquierda a derecha, ESF, CIL y EJE. Haz lo mismo con la fila OI.",
      "Respeta el signo: «−» es miopía, «+» es hipermetropía. Un número sin signo se toma como positivo; si dudas, pregunta.",
      "Si hay una columna ADD con un valor (por ejemplo +2.00), la receta es multifocal: cambia el tipo arriba y escríbela.",
      "Si la receta trae DNP/DIP o altura, cópialas; si no, se miden aquí en la tienda.",
      "Cuando una casilla del papel diga «Plano», «PL», «Sph» o «—», significa cero: deja la casilla en 0.00 o vacía.",
    ],
    why: "Un número cambiado de fila o de signo produce unos lentes que el cliente no puede usar: hay que rehacerlos y la tienda pierde el dinero del laboratorio. Copiar con calma vale más que ir rápido.",
    example: "Receta: OD −2.25 −0.50 × 180 · OI −2.00 −0.75 × 175 · ADD +2.00 · DIP 63. Es multifocal (tiene ADD). Esfera −2.25 y −2.00, cilindro −0.50 y −0.75, ejes 180 y 175, adición +2.00 en los dos ojos y 31.5 mm de DNP por ojo.",
    pitfalls: [
      "Confundir OD con OI: el ojo derecho del cliente es el que queda a TU izquierda cuando lo miras de frente.",
      "Leer «×» o «x» como una multiplicación: solo separa el cilindro del eje.",
      "Olvidar el signo del cilindro: casi siempre es negativo en recetas de optometrista.",
    ],
  },
  "pos.rx.type": {
    title: "Monofocal o multifocal",
    short: "Monofocal: una sola graduación (ver de lejos o de cerca). Multifocal: lejos y cerca en el mismo lente; la receta trae ADD.",
    what: "Un lente monofocal («visión sencilla») tiene la misma graduación en todo el cristal y sirve para una distancia: lejos (conducir, tele) o cerca (leer). Un multifocal reparte lejos arriba y cerca abajo: bifocal (con una línea visible) o progresivo (sin línea, cambio suave). Los multifocales son para quien ya necesita ayuda para leer, normalmente a partir de los 40–45 años.",
    how: [
      "Mira la receta: si tiene un valor en ADD (por ejemplo +1.50), elige «Multifocal».",
      "Si no hay ADD, elige «Monofocal».",
      "Si el cliente te dice que quiere «unos de leer» y la receta trae ADD, también puede llevar un monofocal de cerca: pregúntale al oculista o al encargado antes de decidir.",
      "Al cambiar el tipo aparecen o desaparecen las columnas ADD y ALT; no se pierde lo ya escrito.",
    ],
    why: "El tipo decide qué lentes se pueden vender (en el paso «Lentes» solo salen los compatibles) y qué medidas son obligatorias: un progresivo sin altura de montaje llega mal del laboratorio.",
    pitfalls: [
      "Elegir monofocal cuando la receta tiene ADD: el sistema avisará, pero mejor fijarse antes.",
      "Vender un progresivo a alguien que nunca ha usado uno sin explicarle que tarda unos días en acostumbrarse.",
    ],
  },
  "pos.rx.sph": {
    title: "Esfera (ESF)",
    short: "La graduación principal de cada ojo. Negativa (−) para ver mal de lejos (miopía), positiva (+) para ver mal de cerca (hipermetropía). Va en saltos de 0.25.",
    what: "La esfera dice cuánto hay que «empujar» la imagen para que el ojo enfoque. Un número negativo corrige la miopía (ve mal de lejos); uno positivo corrige la hipermetropía (ve mal de cerca o se cansa). Cuanto más lejos de cero, más fuerte es la graduación y más grueso el lente. Se mide en dioptrías y siempre en pasos de 0.25: −1.75, −2.00, −2.25… nunca −2.10.",
    how: [
      "Copia el número de la columna ESF (o «Sphere», «SPH») de la fila del ojo correspondiente, con su signo.",
      "Si el papel dice «Plano», «PL» o «0», escribe 0.00.",
      "Al salir de la casilla el valor se ajusta solo al formato de la hoja (−2 → −2.00).",
      "Valores admitidos: de −20.00 a +12.00. Fuera de eso el sistema te pide revisar.",
    ],
    why: "Es el número que más afecta a la vista del cliente y al precio: a partir de ±4.00 conviene un material más fino (ver «Lentes»). Un signo equivocado da unos lentes inservibles.",
    example: "OD −3.25 significa: ojo derecho, miopía de 3 dioptrías y cuarto.",
    pitfalls: [
      "Olvidar el signo: «2.00» sin nada se guarda como +2.00 y puede no ser lo que decía la receta.",
      "Escribir el eje o el cilindro en la casilla de la esfera.",
    ],
  },
  "pos.rx.cyl": {
    title: "Cilindro (CIL)",
    short: "Corrige el astigmatismo (la imagen se ve estirada o borrosa en una dirección). Siempre va acompañado de un EJE.",
    what: "El astigmatismo ocurre cuando la parte delantera del ojo no es redonda del todo, sino un poco ovalada, y la persona ve las líneas o las letras deformadas. El cilindro es cuánto hay que corregir eso, y también va en pasos de 0.25 con signo (en recetas de optometrista casi siempre negativo). Si la casilla está vacía, no hay astigmatismo.",
    how: [
      "Copia el número de la columna CIL («Cyl», «Cylinder») con su signo.",
      "Si hay cilindro, el EJE es obligatorio: escríbelo a continuación.",
      "Si no hay cilindro, deja la casilla vacía; el eje se bloquea solo.",
      "Valores admitidos: de −6.00 a +6.00.",
    ],
    why: "Cilindro sin eje es como una dirección sin número de casa: el laboratorio no puede fabricar el lente. Por eso el sistema no deja avanzar.",
    example: "OI −0.75 × 90: el ojo izquierdo tiene 0.75 de astigmatismo en el eje 90.",
    pitfalls: [
      "Escribir el cilindro positivo cuando la receta lo trae negativo (o al revés): el resultado es otro lente distinto.",
      "Dejar el eje vacío «porque es pequeño»: un −0.25 también lleva eje.",
    ],
  },
  "pos.rx.axis": {
    title: "Eje",
    short: "La dirección (de 1 a 180 grados) en la que se coloca el cilindro. Solo existe si hay cilindro.",
    what: "El eje es un ángulo, como la aguja de un reloj: de 1 a 180 grados. Dice en qué dirección está el astigmatismo del ojo para que el laboratorio oriente el cilindro. No lleva decimales ni signo. En la receta aparece después de una «×» o bajo la columna «Eje/Axis».",
    how: [
      "Copia el número entero que sigue al cilindro (por ejemplo «× 180» → 180).",
      "Si el papel dice «0», escribe 180: son lo mismo y el sistema usa 180.",
      "Si no hay cilindro, la casilla queda bloqueada: no hay nada que escribir.",
    ],
    why: "Un eje equivocado por pocos grados ya produce mareo y visión doble con graduaciones altas. Es la causa más común de lentes que vuelven al laboratorio.",
    pitfalls: [
      "Escribir el eje con decimales o con signo.",
      "Cambiar el eje de un ojo por el del otro: suelen ser parecidos pero no iguales.",
    ],
  },
  "pos.rx.add": {
    title: "Adición (ADD)",
    short: "La ayuda extra para ver de cerca en lentes multifocales. Es un valor positivo y suele ser igual en los dos ojos.",
    what: "Con la edad el ojo pierde la capacidad de enfocar de cerca (se llama presbicia o «vista cansada»). La adición es cuánto se suma a la graduación de lejos para la zona de lectura del lente. Siempre es positiva, va de +0.75 a +4.00, y en casi todas las recetas es la misma para los dos ojos: por eso aquí se escribe en un ojo y se copia sola en el otro.",
    how: [
      "Elige «Multifocal» arriba para que aparezca la columna ADD.",
      "Copia el valor de la columna ADD («Add», «Adición», «Near add») con signo +.",
      "Si el papel trae un valor por ojo y son distintos, escribe cada uno.",
      "Si la receta no tiene ADD, el tipo correcto es «Monofocal».",
    ],
    why: "Sin adición no se puede fabricar un bifocal ni un progresivo, y con una adición mal copiada el cliente no podrá leer con sus lentes nuevos.",
    example: "ADD +2.25 en una persona de 55 años es lo habitual; +0.75 suele verse en quien empieza (40–45 años).",
    pitfalls: [
      "Escribirla negativa: la adición siempre suma.",
      "Confundirla con la esfera de cerca: si la receta trae «cerca» como una graduación completa, pide ayuda al encargado para convertirla.",
    ],
  },
  "pos.rx.prism": {
    title: "Prisma",
    short: "Poco frecuente. Corrige ojos que no apuntan al mismo sitio (visión doble). Solo se escribe si el oculista lo puso.",
    what: "El prisma desplaza la imagen para que los dos ojos trabajen juntos cuando uno se desvía un poco. Se mide en «dioptrías prismáticas» (de 0 a 10, en pasos de 0.25) y siempre lleva una dirección, la «base». La mayoría de las recetas no lo tienen; si está, suele aparecer como «Prisma», «Prism» o un triángulo (Δ).",
    how: [
      "Si la receta no menciona prisma, deja la casilla vacía.",
      "Si lo menciona, copia el número en PRISMA y elige la BASE que indique (arriba, abajo, nasal, temporal).",
      "Avisa al encargado: los lentes con prisma tardan más en el laboratorio y pueden cambiar el precio.",
    ],
    why: "Un prisma que falta o está al revés produce visión doble o dolor de cabeza. Como es raro, el error típico es escribir algo aquí por confusión con otra columna.",
    pitfalls: [
      "Poner la DNP o el eje en la casilla de prisma.",
      "Copiar el prisma sin la base: el sistema pide las dos cosas.",
    ],
  },
  "pos.rx.base": {
    title: "Base del prisma",
    short: "Hacia dónde apunta el prisma: arriba, abajo, nasal (hacia la nariz) o temporal (hacia la sien). Solo se activa si hay prisma.",
    what: "La base es la parte gruesa del prisma y marca la dirección en la que se mueve la imagen. En la receta aparece como «BU/BD» (base up/down: arriba/abajo) o «BI/BO» (base in/out: nasal/temporal). Sin prisma, no hay base.",
    how: [
      "Escribe primero el valor en PRISMA; la casilla BASE se desbloquea.",
      "Elige la dirección que diga la receta. «In» o «nasal» = hacia la nariz; «out» o «temporal» = hacia la oreja.",
    ],
    why: "El mismo prisma con la base al revés empeora el problema en lugar de arreglarlo.",
    pitfalls: ["Suponer que la base de un ojo es la misma que la del otro: a menudo son opuestas (uno nasal y otro temporal)."],
  },
  "pos.rx.pd": {
    title: "Distancia pupilar (DNP / DIP)",
    short: "Milímetros desde el centro de la nariz hasta la pupila de cada ojo. Suele estar entre 25 y 35 mm por ojo (50–70 en total).",
    what: "La DIP (distancia interpupilar) es la distancia entre las dos pupilas; la DNP (naso-pupilar) es la mitad de eso medida desde el centro de la nariz a cada pupila, porque muchas caras no son simétricas. Aquí se escribe una por ojo; abajo se muestra la suma (DIP binocular). Sirve para que el centro óptico del lente quede justo delante de la pupila.",
    how: [
      "Si la receta ya trae DIP (por ejemplo «63»), divide entre 2 y escribe 31.5 en cada ojo; si trae dos números (32/31), escribe cada uno en su ojo.",
      "Para medirla: ponte de frente al cliente a la misma altura, a unos 40 cm. Apoya una regla milimetrada sobre su nariz.",
      "Cierra tu ojo derecho y pide al cliente que mire tu ojo izquierdo abierto; alinea el 0 de la regla con el centro de su pupila derecha.",
      "Sin mover la regla, cierra tu ojo izquierdo, abre el derecho y lee el milímetro que cae en el centro de su pupila izquierda: esa es la DIP total.",
      "Para la DNP por ojo, mide desde el centro del puente de la nariz hasta cada pupila. Repite y, si los dos ojos difieren más de 4 mm, mide otra vez.",
    ],
    why: "Si el centro del lente no coincide con la pupila, el cliente ve borroso o con efecto prisma y se marea, aunque la graduación sea correcta. Con progresivos es aún más importante.",
    example: "Adulto típico: 31 + 32 = 63 mm. Niño: 27 + 27 = 54 mm.",
    pitfalls: [
      "Escribir la DIP total (63) en un solo ojo: el sistema rechaza más de 40 mm por ojo.",
      "Medir con el cliente mirando a lo lejos para unos lentes de cerca (la DIP de cerca es unos 3 mm menor).",
    ],
  },
  "pos.rx.seg": {
    title: "Altura de montaje (ALT)",
    short: "Milímetros desde el borde inferior del lente hasta la pupila, con la montura puesta. Obligatoria en multifocales (10–35 mm).",
    what: "En un bifocal o progresivo la zona de cerca está en la parte baja del lente, y hay que decirle al laboratorio exactamente dónde empieza. La altura de montaje (o «altura de segmento») es la distancia vertical, en milímetros, desde el borde más bajo del aro hasta el centro de la pupila, medida con la montura elegida ya puesta y bien ajustada. Es una sola medida para los dos ojos.",
    how: [
      "Pon al cliente la montura que va a comprar, bien centrada y ajustada en la nariz.",
      "Pídele que mire al frente, relajado, a tu ojo a su misma altura (tú sentado o de pie como él).",
      "Con un marcador fino, marca en el lente de muestra el centro de su pupila; o mide directo con la regla desde el borde inferior del aro hasta el centro de la pupila.",
      "Escribe los milímetros en ALT. Si sale menos de 14 mm, el sistema avisa: el progresivo tendría un pasillo muy corto y conviene confirmar el diseño o la montura.",
    ],
    why: "Una altura equivocada por 2 mm hace que el cliente tenga que levantar o bajar la cabeza para leer y que se queje de que «no ve bien»: es la reclamación número uno en progresivos, y el laboratorio no la repone gratis.",
    example: "Montura con aro de 36 mm de alto, pupila un poco por encima del centro: altura ≈ 20 mm.",
    pitfalls: [
      "Medir sin la montura elegida puesta o con ella caída sobre la nariz.",
      "Confundirla con la altura del aro (la medida «B» de la montura).",
    ],
  },
  "pos.rx.ocr": {
    title: "Leer la receta con una foto",
    short: "Toma una foto o sube el archivo: la inteligencia artificial rellena la cuadrícula. Tú debes revisarla y confirmar, casilla por casilla.",
    what: "En vez de teclear, puedes fotografiar la receta (o subir una imagen o PDF que ya tengas). Un sistema de lectura automática reconoce las filas OD/OI, los números y la fecha y los coloca en la cuadrícula. Es una ayuda, no un sustituto: la letra del médico, un reflejo o un sello pueden hacer que lea un 3 por un 8.",
    how: [
      "Pon la receta plana, con buena luz y sin sombras ni dedos encima; la foto debe verse nítida.",
      "Pulsa «Tomar foto» (en tablet o móvil) o «Subir archivo» y espera unos segundos.",
      "Compara cada casilla con el papel: signo, número y eje. Corrige lo que no coincida.",
      "Pulsa «Confirmar» para dejar constancia de que lo revisaste. La venta guarda «Origen: leída de la foto».",
    ],
    why: "Ahorra tiempo y evita errores de tecleo, pero el responsable de la receta sigues siendo tú: una lectura automática sin revisar es la forma más rápida de encargar unos lentes equivocados.",
    pitfalls: [
      "Confirmar sin mirar: los errores de lectura más comunes son el signo del cilindro y el eje.",
      "Fotografiar una receta vencida: revisa la fecha que la IA detectó.",
    ],
  },
  "pos.rx.worn": {
    title: "Lo que usa hoy",
    short: "Anotamos la graduación de los lentes que el cliente trae puestos para compararla con la receta nueva y ver si su vista cambió.",
    what: "Si el cliente ya usa lentes, en el paso «Cliente» se registra su graduación actual (leída de su receta anterior, medida con el lensómetro de la tienda o tomada de una venta previa) y, si quiere, las medidas de su montura actual. No es obligatoria para fabricar los lentes nuevos: es información para aconsejar mejor.",
    how: [
      "Marca «Sí» en «¿Usa espejuelos?».",
      "Elige de dónde sale la graduación: receta anterior, lensómetro o una compra anterior en la tienda (si existe, se propone sola).",
      "Escribe la graduación y, si puedes, cuándo es (fecha exacta o «hace X meses»).",
      "Opcional: mide la montura actual (ancho del lente, puente, varilla) para orientar la elección de la nueva.",
    ],
    why: "Al comparar las dos graduaciones el sistema avisa si hubo un cambio óptico importante: sirve para explicarle al cliente por qué necesita lentes nuevos, para detectar empeoramientos que deben consultarse con el oculista y para que el recibo deje constancia.",
    pitfalls: [
      "Copiar la receta nueva aquí por error: esta cuadrícula es para lo antiguo.",
      "Inventar la altura: en lo que usa hoy no es obligatoria porque el lensómetro no la da.",
    ],
  },

  /* ─────────────── Hacer una venta ─────────────── */
  "pos.step.customer": {
    title: "Paso 1 · Cliente",
    short: "Busca si el cliente ya existe (teléfono, correo o nombre) antes de crearlo. Aquí también anotas si usa lentes hoy.",
    what: "Toda venta pertenece a una persona. En este paso la buscas o la das de alta con nombre, teléfono, correo y fecha de nacimiento; la dirección solo hace falta si el pedido se enviará a casa. Si ya usa espejuelos, se registra su graduación actual (ver «Lo que usa hoy»).",
    how: [
      "Escribe en el buscador parte del nombre, el teléfono o el correo. Si aparece, tócalo: se cargan sus datos y su historial.",
      "Si no aparece, rellena la ficha. Nombre y apellido son obligatorios; el correo sirve para mandar el recibo.",
      "Responde «¿Usa espejuelos?» y, si es que sí, completa su graduación actual.",
      "Pulsa «Siguiente».",
    ],
    why: "Un cliente duplicado reparte su historial en dos fichas y la tienda pierde el seguimiento (saldos, recetas anteriores, garantías). El teléfono es la mejor llave para encontrarlo.",
    pitfalls: [
      "Crear una ficha nueva sin buscar antes.",
      "Escribir el correo con errores: el recibo no llegará y no habrá aviso.",
    ],
  },
  "pos.step.frame": {
    title: "Paso 2 · Montura",
    short: "Elige una montura del inventario de la tienda o registra la que trae el cliente. Solo una por venta.",
    what: "La montura es el armazón. Puede salir del catálogo de la tienda (búsqueda por nombre, marca o código de barras; se elige el color) o ser la propia del cliente, que solo quiere cambiar los lentes. Cada venta lleva exactamente una montura; para dos pares se hacen dos ventas.",
    how: [
      "Para una del inventario: busca por nombre o escanea el código; elige el color y pulsa «Añadir».",
      "Para la del cliente: pulsa «Montura del cliente», descríbela (marca, color) y, si puedes, hazle una foto.",
      "Revisa la tarjeta de la montura y, si te equivocaste, quítala con la papelera y elige otra.",
    ],
    why: "La montura decide el precio base y, en multifocales, la altura de montaje. Registrar la del cliente con foto protege a la tienda si después hay dudas sobre su estado.",
    pitfalls: [
      "Intentar añadir dos monturas: el sistema solo admite una.",
      "Elegir un color que no está en stock en la tienda: fíjate en la disponibilidad de la tarjeta.",
    ],
  },
  "pos.ownFrame": {
    title: "Montura del cliente",
    short: "El cliente trae su propio armazón y solo compra los lentes. Descríbelo y hazle una foto para dejar constancia de cómo llegó.",
    what: "Muchos clientes quieren aprovechar una montura que ya tienen. Se registra como «montura del cliente» con una descripción y una foto; la venta solo cobra los lentes y el trabajo. Esa montura ocupa el único hueco de montura de la venta.",
    how: [
      "En el paso Montura pulsa «Montura del cliente».",
      "Escribe marca, color y cualquier detalle (patilla floja, rayas…).",
      "Toma una foto (en pantallas táctiles) o súbela desde un archivo. Se verá en el recibo detallado y en la hoja del laboratorio.",
      "Pulsa «Guardar». En el paso Receta será obligatorio poner graduación: una montura ajena sin lentes no es una venta.",
    ],
    why: "Las monturas usadas pueden romperse al montar lentes nuevos. La foto y la descripción al recibirla evitan discusiones después.",
    pitfalls: ["Marcar «Sin receta» con una montura del cliente: no hay nada que vender."],
  },
  "pos.step.lenses": {
    title: "Paso 4 · Lentes",
    short: "Elige el tipo de lente (sencillo, bifocal, progresivo), el material (más fino cuanto más alta la graduación), si es fotocromático y el antirreflejo.",
    what: "Los lentes son los cristales que van en la montura. Se eligen cuatro cosas. Tipo: visión sencilla (una distancia), bifocal (lejos y cerca con línea) o progresivo (lejos, intermedio y cerca sin línea). Material: CR-39 (plástico básico, grueso con graduaciones altas), policarbonato (ligero y resistente a golpes, ideal para niños y deporte), 1.67 y 1.74 (cada vez más finos y ligeros, para graduaciones altas). Fotocromático: se oscurece al sol y vuelve claro dentro. Antirreflejo (AR): capa que quita los reflejos, mejora la visión nocturna y la estética.",
    how: [
      "El tipo ya viene filtrado por la receta: si es monofocal solo verás visión sencilla; si es multifocal, bifocal o progresivo.",
      "Elige el material. El sistema marca con ★ el recomendado según la graduación más alta de la receta: hasta ±2.00 vale CR-39; de ±2.00 a ±4.00, policarbonato; de ±4.00 a ±6.00, 1.67; más de ±6.00, 1.74.",
      "Fotocromático: pregúntale al cliente si pasa tiempo al aire libre o conduce de día.",
      "Antirreflejo: recomiéndalo siempre con ordenador, conducción nocturna o graduaciones altas.",
      "Si es «solo montura» (sin lentes), elige esa opción en el tipo.",
    ],
    why: "Material y tratamientos son la mayor parte del precio y de la satisfacción: un lente grueso en una montura fina se ve mal, y un progresivo sin antirreflejo decepciona de noche. Explicar las opciones vende mejor que imponerlas.",
    example: "Receta −5.50 en un ojo: el recomendado es 1.67; con policarbonato el borde quedaría muy grueso.",
    pitfalls: [
      "Vender policarbonato con graduaciones altas para abaratar: el cliente volverá por el grosor.",
      "Olvidar la altura de montaje en progresivos: el paso no deja avanzar sin ella.",
    ],
  },
  "pos.step.price": {
    title: "Paso 5 · Precio y descuento",
    short: "El sistema calcula el total. Puedes aplicar un descuento hasta tu límite; más que eso necesita la aprobación de un encargado o del dueño.",
    what: "Aquí ves el precio de lista de cada artículo, los impuestos y el total, calculados por el servidor (nunca a mano). El descuento se escribe en porcentaje. Cada persona tiene un límite de descuento según su rol; si lo superas, o si un artículo queda por debajo de su precio mínimo, la venta se bloquea hasta que alguien con permiso la apruebe desde su propio panel.",
    how: [
      "Revisa los artículos y precios. Si algo no cuadra, vuelve al paso correspondiente.",
      "Escribe el descuento (por ejemplo 10) si procede. El total se recalcula solo.",
      "Si aparece «Necesita aprobación», escribe el motivo y pulsa «Pedir aprobación». Espera a que cambie a «Aprobada» (el encargado la ve en Aprobaciones).",
      "Si la receta nueva difiere mucho de lo que usa hoy, verás un aviso de cambio óptico: coméntaselo al cliente.",
    ],
    why: "Los descuentos sin control se comen la ganancia; la aprobación deja rastro de quién autorizó cada uno y por qué. El precio mínimo protege el costo del laboratorio.",
    pitfalls: [
      "Escribir el descuento en dinero: la casilla es en porcentaje.",
      "Prometer un precio al cliente antes de ver si necesita aprobación.",
    ],
  },
  "pos.step.payment": {
    title: "Paso 6 · Pago",
    short: "Registra cómo paga el cliente (efectivo, tarjeta, Zelle, seguro…). Puede dejar un anticipo y pagar el resto al recoger. El recibo va por correo si lo pides.",
    what: "La venta puede cobrarse completa o en parte. Cada línea de pago tiene un método, un importe y, según el método, una referencia (últimos 4 dígitos, número de confirmación…). Lo que falte queda como «Por cobrar» y se cobra después desde la venta. Al terminar se imprime el recibo (dos copias en una hoja carta: cliente y tienda) y, si hay correo, se envía uno simple; el detallado (con receta y fotos) solo si lo marcas.",
    how: [
      "Comprueba el resumen de la venta. Puedes editar cualquier paso desde ahí.",
      "Elige el método de pago y escribe el importe; «Resto» rellena lo que falta. Con efectivo, escribe lo que entrega el cliente para ver el cambio.",
      "Para un anticipo, escribe solo esa cantidad: el saldo queda pendiente y aparece en el recibo.",
      "Si pagan con dos métodos, pulsa «Otro pago».",
      "Elige recogida en tienda o envío (el envío necesita la dirección del cliente).",
      "Marca «Enviar recibo por correo» si el cliente lo quiere, y «con detalles» solo si pidió ver receta y fotos.",
      "Pulsa «Cobrar y registrar». Se abre la hoja de recibos para imprimir.",
    ],
    why: "El dinero que entra aquí es el que luego cuadra la caja: un método mal elegido (tarjeta anotada como efectivo) descuadra el cierre del día. El saldo pendiente avisa a la tienda de lo que falta por cobrar al entregar.",
    pitfalls: [
      "Cobrar más que el total: el sistema lo bloquea.",
      "Olvidar la referencia de la tarjeta o de Zelle cuando el método la pide.",
    ],
  },

  /* ─────────────── Panel ejecutivo ─────────────── */
  "exec.overview": {
    title: "Panel ejecutivo",
    short: "La foto del negocio en un período: cuánto se vendió, cuánto entró, cuánto costó y cuánto quedó. Toca cualquier cifra para ir al detalle.",
    what: "Es la pantalla del dueño y de los encargados. Arriba eliges tienda y período; en medio ves los indicadores (KPI) principales; abajo, acordeones con los pedidos, la caja, los vendedores y los costos del mismo período. Cada tarjeta se puede exportar a Excel, CSV o PDF.",
    how: [
      "Elige la tienda (o todas) y el período (hoy, semana, mes o un rango).",
      "Lee los KPI de izquierda a derecha: ventas → cobrado → por cobrar → costo → ganancia → margen.",
      "Abre los acordeones para ver de dónde salen los números; haz clic en un KPI para ir a la pantalla que lo explica.",
      "Para una reunión, usa «Excel» o «PDF» en la barra: incluye los filtros aplicados.",
    ],
    why: "Mirar esto cada semana con el mismo período permite ver tendencias (el «vs. período anterior») y detectar a tiempo una tienda que vende pero no cobra, o que cobra pero no gana.",
  },
  "exec.period": {
    title: "Período",
    short: "Las fechas que se están sumando. Todo el panel (KPI, pedidos, caja) cambia a la vez.",
    what: "El período delimita qué ventas y cobros entran en los números. «Hoy», «Esta semana», «Este mes» son atajos; «Rango» permite dos fechas cualesquiera. El comparativo «vs. período anterior» usa un tramo igual de largo justo antes.",
    how: [
      "Toca un atajo, o elige «Rango» y escribe desde/hasta.",
      "Comprueba que la fecha «hasta» incluye el día completo (sí: hasta las 23:59).",
    ],
    why: "Comparar períodos de distinta longitud lleva a conclusiones falsas. Para ver crecimiento, compara mes con mes o semana con semana.",
    pitfalls: ["Mirar «Por cobrar» pensando que es del período: ese KPI es el saldo pendiente hoy, venga de cuando venga."],
  },
  "exec.storeFilter": {
    title: "Filtro de tienda",
    short: "Elige una tienda o todas. Un encargado o vendedor solo ve las suyas; el dueño las ve todas y la tienda online.",
    what: "Cada venta pertenece a una tienda física (o a la web). Este filtro es global para todo el panel: se recuerda al cambiar de pestaña y tiñe la cabecera con el color de la tienda elegida para que sepas siempre dónde estás.",
    how: [
      "Despliega el selector y elige la tienda, «Todas» o «Web».",
      "Con «Todas», los acordeones muestran una columna extra con la tienda de cada fila.",
    ],
    why: "Comparar tiendas con el mismo período es la forma más rápida de ver cuál necesita atención. Y evita el error clásico de cuadrar la caja de una tienda con las ventas de todas.",
  },
  "exec.kpi.sales": {
    title: "Ventas",
    short: "Todo lo vendido en el período, con impuestos y con los descuentos ya restados. Las ventas anuladas no cuentan.",
    what: "Es la suma de los totales de las ventas registradas en el período (fecha de la venta, no del cobro). Incluye lo que todavía no se ha cobrado del todo. Debajo aparece la variación frente al período anterior.",
    how: ["Haz clic en el KPI para abrir el Panel de ventas, donde se desglosa por día, vendedor y producto."],
    why: "Es la cifra de actividad: si sube pero «Cobrado» no, la tienda está fiando demasiado.",
    pitfalls: ["Compararla con lo que entró en caja: son cosas distintas (ver «Cobrado»)."],
  },
  "exec.kpi.collected": {
    title: "Cobrado",
    short: "Lo que las ventas del período llevan cobrado hasta hoy: anticipos y abonos de las ventas de tienda, y el total de los pedidos web (se pagan al comprar).",
    what: "Se cuenta por la fecha de la VENTA: para cada venta del período suma lo que ya se le cobró (anticipo y cualquier abono posterior). El resto que hoy paga un cliente por una venta del mes pasado suma a ese mes pasado, no a hoy. La parte que paga un seguro no cuenta aquí. El dinero que entró en caja en el período, sea de la venta que sea, está en «Efectivo en caja» y en el Informe de caja.",
    how: ["Haz clic para ir a Caja y ver los cobros por método (efectivo, tarjeta, Zelle…)."],
    why: "Es lo que se puede depositar en el banco. Ventas altas con cobros bajos significan saldos pendientes que hay que perseguir.",
  },
  "exec.kpi.balance": {
    title: "Por cobrar",
    short: "Lo que las ventas del período todavía deben HOY. Lo que se debe de ventas de cualquier fecha es «Dinero en la calle».",
    what: "Suma, para las ventas no anuladas del período y la(s) tienda(s) elegida(s), el saldo que cada una debe hoy. Un anticipo deja el resto aquí hasta que el cliente recoge y paga; en cuanto paga, baja también en los períodos pasados. Para ver lo que se debe sin importar la fecha de la venta, mira «Dinero en la calle» o Cobros pendientes.",
    how: ["Haz clic para ver la lista de ventas con saldo y cobrar desde cada una."],
    why: "Dinero que la tienda ya gastó en laboratorio y todavía no ha recibido. Si crece mes a mes, hay que revisar la política de anticipos.",
  },
  "exec.kpi.cost": {
    title: "Costo real",
    short: "Lo que costó producir lo vendido: monturas y lentes (reglas de Costos), fijos por pedido y la comisión del cobro. Solo lo ven quienes pueden ver costos.",
    what: "Cada venta tiene un costo calculado con las reglas de la pestaña Costos: precio de compra de la montura, costo del laboratorio por tipo de lente y material, partidas fijas por pedido (estuche, envío al laboratorio) y la comisión que cobra el método de pago (tarjeta, Zelle). Si a alguna venta le falta una regla, el KPI avisa cuántas son.",
    how: [
      "Si aparece «N ventas con algún costo sin definir», haz clic: te lleva a las reglas para completarlas.",
      "Las reglas actuales se aplican también al pasado: cambiar una cambia el costo de meses anteriores.",
    ],
    why: "Sin costo no hay ganancia real: una tienda puede vender mucho y perder dinero por un laboratorio caro o por descuentos. Por eso solo el dueño, los superadmin y quien tenga el permiso «ver costos» lo ven; los vendedores no.",
    pitfalls: ["Tomar el costo como gasto total: la renta, la luz y los sueldos están en el estado de cuenta, no aquí."],
  },
  "exec.kpi.profit": {
    title: "Ganancia bruta",
    short: "Ventas sin impuestos − costo real − comisión de vendedores. Antes de renta, sueldos y otros gastos del mes.",
    what: "Es lo que queda de cada venta después de pagar lo que costó producirla y la comisión del vendedor. No descuenta los gastos del local (renta, luz, nómina): eso se resta en el estado de cuenta de la tienda. Se muestra con la variación frente al período anterior.",
    how: ["Haz clic para ver el desglose de ganancia por venta en Costos → Ganancia."],
    why: "Es el número que dice si vender más de verdad conviene. Una ganancia bruta negativa en un período señala descuentos excesivos o costos sin actualizar.",
  },
  "exec.kpi.margin": {
    title: "Margen",
    short: "Qué porcentaje de cada venta (sin impuestos) se queda como ganancia bruta.",
    what: "Margen = ganancia bruta ÷ ventas sin impuestos × 100. Permite comparar tiendas o meses de tamaño distinto: un margen del 55 % con ventas pequeñas puede ser mejor negocio que un 30 % con ventas grandes.",
    how: ["Compara el margen entre tiendas y entre períodos; si baja, mira primero los descuentos y luego los costos del laboratorio."],
    why: "En óptica un margen bruto sano suele estar entre el 50 y el 65 %. Por debajo del 40 % hay que revisar precios o proveedores.",
  },
  "exec.orders": {
    title: "Pedidos de la tienda",
    short: "La lista de ventas del período con su costo, ganancia y lo cobrado. Es de donde salen los KPI de arriba.",
    what: "Cada fila es una venta: número, fecha, cliente, vendedor, total, cobrado, pendiente y, para quien puede verlo, costo y ganancia. Las anuladas aparecen tachadas y no suman.",
    how: [
      "Abre el acordeón y usa la búsqueda o el orden de columnas.",
      "Haz clic en una venta para abrirla: desde ahí se cobra el saldo, se reenvía el recibo o se imprime la hoja del laboratorio.",
      "Exporta a Excel para conciliar con el banco o con el laboratorio.",
    ],
    why: "Es la fuente de verdad: si un KPI parece raro, aquí se ve qué venta lo explica.",
  },
  "exec.ordersPlain": {
    title: "Pedidos de la tienda",
    short: "La lista de ventas del período: total, cobrado y pendiente de cada una. Es de donde salen los KPI de arriba.",
    what: "Cada fila es una venta: número, fecha, cliente, vendedor, total, cobrado y pendiente. Las anuladas aparecen tachadas y no suman. El costo y la ganancia solo los ve quien tiene el permiso «Ver costos»; por eso no aparecen aquí.",
    how: [
      "Abre el acordeón y usa la búsqueda o el orden de columnas.",
      "Haz clic en una venta para abrirla: desde ahí se cobra el saldo, se reenvía el recibo o se imprime la hoja del laboratorio.",
      "Exporta a Excel para conciliar con el banco o con el laboratorio.",
    ],
    why: "Es la fuente de verdad: si un KPI parece raro, aquí se ve qué venta lo explica.",
  },
  "exec.overviewPlain": {
    title: "Panel ejecutivo",
    short: "La foto del negocio en un período: cuánto se vendió, cuánto entró y cuánto queda por cobrar. Toca cualquier cifra para ir al detalle.",
    what: "Arriba eliges tienda y período; en medio ves los indicadores (KPI) de ventas y cobros; abajo, acordeones con los pedidos, la caja y los vendedores del mismo período. El costo, la ganancia y el margen solo los ve quien tiene el permiso «Ver costos». Cada tarjeta se puede exportar a Excel, CSV o PDF.",
    how: [
      "Elige la tienda (o todas) y el período (hoy, semana, mes o un rango).",
      "Lee los KPI de izquierda a derecha: ventas → cobrado → por cobrar.",
      "Abre los acordeones para ver de dónde salen los números; haz clic en un KPI para ir a la pantalla que lo explica.",
      "Para una reunión, usa «Excel» o «PDF» en la barra: incluye los filtros aplicados.",
    ],
    why: "Mirar esto cada semana con el mismo período permite ver tendencias (el «vs. período anterior») y detectar a tiempo una tienda que vende pero no cobra.",
  },
  "exec.cash": {
    title: "Caja del período",
    short: "Los cobros agrupados por método de pago (efectivo, tarjeta, Zelle…) más las entradas y salidas manuales de efectivo.",
    what: "Muestra, para el período y tienda elegidos, cuánto entró por cada método, las devoluciones, la comisión que cobra cada método y el neto; y debajo los movimientos manuales de caja (pagos a proveedor, depósitos al banco, retiros…). El «Efectivo en caja» es efectivo cobrado + entradas − salidas.",
    how: [
      "Compara el efectivo neto con lo que se depositó en el banco: deberían coincidir salvo el fondo de cambio.",
      "Haz clic para ir a Caja y ver los cierres de cada día.",
    ],
    why: "El efectivo es lo que más se pierde sin querer (y a veces queriendo). Revisarlo contra los cierres y los depósitos es el control básico de una tienda.",
  },

  /* ─────────────── Caja ─────────────── */
  "cash.session": {
    title: "Abrir y cerrar la caja",
    short: "Al empezar el día se abre la caja con el fondo de cambio; al terminar se cuenta el efectivo y se cierra. El sistema compara lo contado con lo esperado.",
    what: "Una «sesión de caja» es un turno: empieza al abrir con el dinero inicial (fondo para dar cambio) y termina al cerrar contando lo que hay. Durante la sesión se suman los cobros en efectivo y los movimientos manuales. Al cerrar, el sistema calcula lo que debería haber (esperado) y muestra la diferencia con lo contado.",
    how: [
      "Abrir: elige el punto de venta, escribe el fondo inicial (por ejemplo 100) y pulsa «Abrir caja».",
      "Durante el día, registra cualquier dinero que entre o salga sin ser una venta (ver «Movimientos»).",
      "Cerrar: cuenta todo el efectivo del cajón, escríbelo en «Contado», añade una nota si hay diferencia y pulsa «Cerrar caja».",
      "Si la diferencia no es cero, el sistema pide confirmarla: queda registrada con tu nombre.",
    ],
    why: "Sin apertura y cierre no hay forma de saber si falta dinero ni cuándo faltó. Una caja abierta de ayer bloquea además la de hoy.",
    example: "Fondo 100 + ventas en efectivo 850 − pago al proveedor 200 = esperado 750. Contado 745 → diferencia −5.",
    pitfalls: [
      "Dejar la caja abierta varios días: las diferencias se vuelven imposibles de rastrear.",
      "Cerrar sin contar y escribir el esperado: la caja «cuadra» siempre y no sirve para nada.",
    ],
  },
  "cash.movement": {
    title: "Movimientos de caja",
    short: "Dinero que entra o sale del cajón sin ser una venta: pagar a un proveedor, llevar un depósito al banco, un retiro del dueño… Siempre con motivo y nota.",
    what: "Un movimiento es una entrada o salida de efectivo que no viene de cobrar a un cliente. Lleva tipo (entrada/salida), importe, un motivo de la lista y una nota libre. Motivos: pago a proveedor, gasto (p. ej. limpieza), retiro del dueño, depósito al banco, fondo de cambio, devolución a un cliente, corrección de un error y otro.",
    how: [
      "Con la caja abierta, elige Entrada o Salida.",
      "Escribe el importe, elige el motivo y escribe una nota concreta («factura 1234 de Óptica Proveedor»).",
      "Pulsa «Registrar». El esperado de la caja se actualiza al momento.",
    ],
    why: "Cada billete que sale sin anotar aparece al cierre como «falta dinero». La nota es lo que permite, semanas después, entender qué pasó.",
    pitfalls: [
      "Usar «Otro» para todo: los informes agrupan por motivo y «Otro» no explica nada.",
      "Registrar una devolución como salida sin anularla en la venta: la venta seguirá contando como cobrada.",
    ],
  },
  "cash.report": {
    title: "Informe de caja",
    short: "Resumen de un período: cobros por método, movimientos manuales, cierres con sus diferencias y el efectivo día a día. Se exporta a Excel o PDF.",
    what: "Es el historial de la caja de una tienda. Para el período elegido muestra: cuánto entró por cada método de pago; los movimientos manuales con motivo y quién los hizo; cada cierre con esperado, contado y diferencia; y una gráfica por día. Se puede filtrar por persona.",
    how: [
      "Elige el período (hoy, semana, mes o rango) y, si quieres, la persona.",
      "Abre «Cierres» para ver las diferencias: una diferencia repetida en el mismo turno merece una conversación.",
      "Exporta a Excel para el contador o a PDF para archivar.",
    ],
    why: "Es el documento que concilia la tienda con el banco y el que responde a «¿dónde está el dinero de tal día?».",
  },

  /* ─────────────── Informes ─────────────── */
  "statement.what": {
    title: "Estado de cuenta de la tienda",
    short: "El resumen mensual de una tienda: ventas, cobros por método, por vendedor y por día. En tiendas socias incluye la liquidación (qué parte le corresponde).",
    what: "Cada mes se genera un estado de cuenta por tienda, con número EST-<tienda>-<AAAAMM>. Resume las ventas del mes (incluidas las anuladas, aparte), los cobros por método, el reparto por vendedor y por día. Si la tienda es de un socio o en consignación, al final aparece la liquidación: la base (ventas sin impuestos) por el porcentaje acordado con esa tienda.",
    how: [
      "Elige la tienda y el mes (este, el anterior o un rango).",
      "Revisa cada sección; las anuladas se ven aparte para que no haya sorpresas.",
      "Pulsa «PDF» para entregarlo o enviarlo al socio; «Excel» para el contador.",
    ],
    why: "Es el documento que se firma con el socio o el que se usa para pagar impuestos. Que sea el mismo cada mes, generado por el sistema, evita discusiones.",
    pitfalls: ["Generarlo antes de cerrar el último día del mes: faltarán cobros."],
  },
  "salesboard.what": {
    title: "Panel de ventas",
    short: "Cuánto se vendió y cuánto se ganó, por hora, día, semana, mes o año, y por tienda, vendedor o producto. Haz clic en una fila para bajar al detalle.",
    what: "Es la herramienta para analizar ventas: una gráfica de tendencia y tablas por tienda, vendedor, marca, producto o tipo de lente. Cada fila se puede «enfocar»: al tocar un vendedor, todo el panel muestra solo sus ventas, y así hasta llegar a la lista de ventas concretas. Los vendedores ven solo lo suyo; costo y ganancia solo quien tiene permiso.",
    how: [
      "Elige el período y la unidad de tiempo (ver «Ver por»).",
      "Toca una tienda, luego un vendedor, luego un producto: los chips de arriba muestran el filtro activo; quítalos con la ×.",
      "Activa «Comparar» para ver el período anterior al lado.",
      "Exporta la vista a Excel con todos los filtros aplicados.",
    ],
    why: "Responde preguntas concretas: ¿qué vendedor vende más progresivos? ¿a qué hora llega más gente? ¿qué marca deja más margen?",
  },
  "salesboard.grain": {
    title: "Ver por (hora, día, semana…)",
    short: "La unidad de tiempo de la gráfica. Por hora para ver el ritmo del día; por día o semana para un mes; por mes para un año.",
    what: "Define cómo se agrupa la línea de tiempo. «Hora» muestra el día a lo largo de las horas (útil para turnos); «Día» y «Semana» (semanas de lunes a domingo) para un mes; «Mes» y «Año» para períodos largos. Las opciones que no tienen sentido para el período elegido se deshabilitan.",
    how: ["Elige el período y después la unidad. Si no eliges ninguna, el sistema usa la más razonable."],
    why: "Mirar un año por días es ruido; mirar una semana por meses no dice nada. La unidad adecuada hace visible la tendencia.",
  },

  /* ─────────────── Configuración ─────────────── */
  "stores.color": {
    title: "Color de la tienda",
    short: "Cada tienda tiene un color propio. Aparece en los correos internos, en la cabecera del panel y en los informes para saber de qué tienda es cada cosa de un vistazo.",
    what: "Al crear una tienda se le asigna automáticamente un color que ninguna otra tiene; puedes cambiarlo por uno de la paleta o cualquier otro. Se usa como franja en los correos de ventas y alertas, como círculo junto al asunto (la bandeja de entrada no muestra colores), en el panel cuando filtras por esa tienda y en el estado de cuenta. El recibo del cliente no lo lleva.",
    how: [
      "Al crear: acepta el color propuesto o elige otro de las muestras.",
      "Para cambiarlo: Tiendas → Editar → elige una muestra o usa el selector de color.",
      "Evita dos tiendas con colores parecidos: el sistema no lo impide, pero confunde.",
    ],
    why: "Con varias tiendas, el color es la señal más rápida para no cuadrar la caja de una con las ventas de otra, y para que un correo de alerta se identifique sin leerlo entero.",
  },
  "team.roles": {
    title: "Roles del equipo",
    short: "Dueño y superadmin lo ven todo; supervisor varias tiendas; encargado su tienda; vendedor solo sus ventas. El rol decide qué pantallas y qué números ve cada persona.",
    what: "Cada persona del panel tiene un rol. Dueño: hay uno solo; lo puede todo y es el único que nombra superadmins. El dueño o un superadmin puede traspasar la propiedad a otro superadmin («Hacer dueño», con su contraseña) y el anterior queda como superadmin. Superadmin: mismos derechos que el dueño (precios, aprobaciones, alertas, equipo). Supervisor: ve y aprueba en las tiendas que se le asignan, con costos. Encargado: gestiona su tienda (caja, ventas, equipo de la tienda, aprobaciones hasta su límite). Vendedor: hace ventas y ve solo las suyas y su comisión; no ve costos ni ganancia.",
    how: [
      "Al crear a alguien, elige el rol y, salvo dueño/superadmin, las tiendas a las que tiene acceso.",
      "Un vendedor necesita además su ficha de vendedor (tienda, punto de venta y comisión).",
      "Para cambiar un rol, usa el selector de su fila; para quitar el acceso, desactiva todas sus asignaciones.",
      "Cada persona puede tener su propio límite de descuento, por encima o por debajo del de su rol.",
    ],
    why: "Dar más permisos de los necesarios expone costos y márgenes a quien no debe verlos y permite descuentos sin control. Dar menos obliga a pedir aprobación por todo.",
    pitfalls: ["Hacer superadmin a un encargado «para que no moleste»: verá todas las tiendas y sus costos."],
  },
  "posconfig.methods": {
    title: "Formas de pago",
    short: "Las formas en que la tienda acepta dinero (efectivo, tarjeta, Zelle, seguro…), con su comisión, en qué tiendas se usan y si piden referencia.",
    what: "Cada forma de pago tiene: nombre, tipo, comisión (porcentaje y/o fijo que cobra el banco o la plataforma, que se carga como costo de la venta), si cuenta como efectivo (entra en la caja y en el cierre), si es «por cobrar» (como un seguro que paga después), qué datos de referencia pide al cobrar (últimos 4 dígitos, confirmación) y en qué tiendas está activa.",
    how: [
      "Para añadir: escribe el nombre (y en inglés si quieres), elige el tipo, la comisión y marca si cuenta como efectivo o es por cobrar.",
      "Añade los campos de referencia que el cajero deberá rellenar y marca los obligatorios.",
      "Elige las tiendas donde se acepta y guarda.",
      "Una forma usada en alguna venta no se borra: se desactiva para que las ventas antiguas sigan cuadrando.",
    ],
    why: "La comisión correcta es lo que hace que la ganancia sea real (una tarjeta al 3 % en una venta de 400 son 12 dólares). Y «cuenta como efectivo» es lo que decide si el cierre de caja cuadra.",
    pitfalls: ["Marcar la tarjeta como efectivo: el cierre siempre dará sobrante."],
  },
  /* ─────────────── Vendedores (Ejecutivo y panel del vendedor) ─────────────── */
  "exec.sellers.quota": {
    title: "Cuota del vendedor",
    short: "Qué parte de TODAS las ventas del período (de la tienda elegida, o de todas) hizo este vendedor. 25 % = una de cada cuatro ventas en dinero es suya.",
    what: "Es el porcentaje de sus ventas sobre el total vendido en el mismo período y el mismo filtro de tienda: ventas del vendedor ÷ ventas totales × 100. Se calcula en dinero (no en número de ventas) y cuenta también las ventas que no tienen vendedor asignado, así que las cuotas de todos los vendedores no tienen por qué sumar 100 %.",
    how: [
      "Elige el período y la tienda arriba: la cuota se recalcula con ese filtro.",
      "Compara la cuota con la comisión: un vendedor con cuota alta y comisión baja te sale barato; al revés, revisa su porcentaje.",
      "En el reporte de vendedores la cuota va en la última columna, ordenada de mayor a menor venta.",
    ],
    why: "Dice de quién depende la tienda. Si una sola persona tiene el 70 %, un día libre suyo se nota en caja; si las cuotas están repartidas, el equipo vende parejo.",
    example: "La tienda vendió 10 000 en el mes; Ana vendió 2 500 → cuota 25 %. Si 1 000 fueron ventas web sin vendedor, la suma de las cuotas del equipo será 90 %.",
    pitfalls: ["Leerla como «porcentaje de comisión»: la comisión es lo que se le paga; la cuota es lo que vendió respecto al resto."],
  },
  "exec.sellers.avgProfit": {
    title: "Ganancia promedio por venta",
    short: "Lo que te deja, de media, cada venta de este vendedor después de materiales, costos fijos, comisiones del cobro y su propia comisión.",
    what: "Ganancia bruta de sus ventas del período ÷ número de ventas. La ganancia es la del Panel de ventas: neto − costo de monturas y lentes − costos fijos por pedido − comisión del cobro (tarjeta) − comisión del vendedor. La renta y los gastos del mes no entran.",
    how: [
      "Solo la ve quien puede ver costos (dueño, superadmin o con el permiso «ver costos»).",
      "Compárala entre vendedores con un ticket medio parecido: uno que vende caro pero con mucho descuento puede dejar menos por venta que otro que vende menos.",
    ],
    why: "Vender mucho no es lo mismo que ganar: esta cifra dice qué vendedor convierte cada venta en dinero para la tienda.",
    pitfalls: ["Juzgar con pocas ventas: con dos o tres ventas una montura sin costo definido mueve mucho el promedio (mira el aviso de «ventas sin costo»)."],
  },
  "exec.sellers.commission": {
    title: "Comisión a pagar",
    short: "Lo que le debes al vendedor por sus ventas del período: su porcentaje aplicado al neto de cada venta (sin impuestos).",
    what: "Suma de la comisión de cada una de sus ventas: neto de la venta × su porcentaje. El porcentaje se toma de su perfil de Equipo o, si no tiene, de su ficha de Vendedores. Cambiar el porcentaje recalcula también el pasado.",
    how: [
      "Elige el período de pago (normalmente «Mes pasado») y lee la columna Comisión; el reporte PDF/Excel la lleva por vendedor.",
      "Si un vendedor no aparece es que no vendió en el período: el Ejecutivo quita a los que no venden.",
    ],
    why: "Es un costo real de cada venta: ya está restado en la ganancia. Pagarla con otra base (el total con impuestos, por ejemplo) descuadra el margen.",
    pitfalls: ["Pagar sobre el total cobrado en caja: la comisión se calcula sobre lo vendido en el período, no sobre lo cobrado."],
  },
  /* ─────────────── Caja (cierre de tienda, nov-2026) ─────────────── */
  "cash.close": {
    title: "Cerrar la caja de la tienda y autorizar diferencias",
    short: "La caja es de toda la tienda. Al cerrar se cuenta el cajón (contador de billetes), se firma con las iniciales y, si no cuadra, el cierre queda pendiente hasta que el dueño lo autorice con su firma.",
    what: "Desde noviembre de 2026 hay UNA caja por tienda, no una por punto de venta: el primer cobro en efectivo del día la abre solo (con lo que quedó contado en el último cierre) y todo el efectivo de cualquier punto de venta entra en el mismo libro. Cada cobro en efectivo, cada devolución y cada movimiento manual es una línea del libro; «Debe haber» = fondo inicial + entradas − salidas. Al cerrar, el sistema compara lo contado con lo que debe haber. Si cuadra, la caja queda cerrada. Si no cuadra, el cierre queda «Pendiente de autorizar» y solo el dueño (o un superadministrador) lo cierra firmando con sus iniciales; el dueño puede hacerlo en el mismo paso si es él quien cierra. La apertura y el cierre se imprimen por duplicado (copia de la tienda y copia de quien cierra) y llegan por correo al dueño.",
    how: [
      "Pulsa «Cerrar caja». Cuenta el cajón con el contador (cuántos billetes de 100, 50, 20… y monedas) o escribe el total a mano.",
      "Mira la diferencia en vivo: verde si cuadra, rojo si falta, ámbar si sobra. Escribe tus iniciales (2 a 4 letras) y, si hay diferencia, una nota con lo que pasó.",
      "Si eres el dueño y hay diferencia, escribe también tus iniciales en «Autorizar con mi firma» para cerrar de una vez. Si no, el cierre aparece arriba en «pendientes» hasta que el dueño pulse «Aprobar».",
      "Imprime el cierre (2 copias) y guarda la de la tienda con el efectivo; el correo al dueño sale solo (y se puede reenviar).",
    ],
    why: "El dueño pidió que el cierre siempre cuadre al entregar el dinero y que una discrepancia solo la autorice él, con firma. Las iniciales en el documento y en la auditoría dicen quién contó y quién autorizó, sin firmar en papel.",
    example: "Fondo 100 + cobros en efectivo 850 − devolución 20 − pago a proveedor 200 = debe haber 730. Contado 725 → diferencia −5: queda pendiente; el dueño la autoriza con «DR» y la caja pasa a cerrada.",
    pitfalls: [
      "Cerrar escribiendo el «debe haber» en vez de contar: la caja cuadra siempre y no sirve para nada.",
      "Dejar cierres pendientes acumulados: cada uno es dinero sin explicar; se revisan el mismo día.",
      "Registrar un cobro en efectivo como tarjeta: no entra en el libro y al cierre «sobra» o «falta» sin motivo.",
    ],
  },
  /* ─────────────── Precios y costos (panel «Precios y costos», nov-2026) ─────────────── */
  "price.rule": {
    title: "La regla de precio de todas las monturas",
    short: "Una sola instrucción fija el precio de VENTA de todas las monturas a partir del precio base: «+35 % sobre el base». No hay que tocar monturas una por una.",
    what: "El precio base de una montura es lo que ya tiene cargado el catálogo. La regla dice qué se le hace a ese número para llegar al precio que paga el cliente: un porcentaje encima («+35 %») o un monto fijo por venta («+20»). Se aplica a TODAS las monturas a la vez, y hay otra regla igual para los estuches. Con «Todas las tiendas» arriba estás fijando la regla del maestro, que es la que usan todas; si eliges una tienda, esa tienda tiene su propia regla y la del maestro deja de valer para ella.",
    how: [
      "Arriba, en el selector de tienda, elige «Todas las tiendas» para la regla general, o una tienda para ponerle una distinta.",
      "En «Monturas y estuches», en la fila «Regla para todas las monturas», elige «Porcentaje sobre el base» o «Monto fijo por venta».",
      "Escribe el número (35 = +35 %; −10 = 10 % menos) y pulsa Guardar. Al lado se lee lo que queda vigente.",
      "«Sin regla» quita la regla: se cobra el precio base tal cual.",
    ],
    why: "Es la diferencia entre decidir el margen una vez y perseguir quinientos precios a mano. Cambiar la regla cambia el precio de todo el escaparate en el acto, y queda en el historial con la fecha.",
    example: "Montura con base $20 y regla +35 % → se vende a $27. Cambias la regla a +50 % y la misma montura pasa a $30 sin tocarla.",
    pitfalls: [
      "Escribir 1.35 en vez de 35: la casilla es el porcentaje que se SUMA, no un multiplicador.",
      "Pensar que la regla toca los lentes: los lentes tienen su propia matriz y su propio porcentaje por tienda.",
      "Poner la regla con una tienda elegida creyendo que es la general: mira la pastilla de arriba («Maestro» o el nombre de la tienda).",
    ],
  },
  "price.override": {
    title: "Precio propio de una montura (saltarse la regla)",
    short: "Buscas la montura, le escribes el precio que quieras y esa queda fuera de la regla. La pantalla enseña solo la regla y las que cambiaste.",
    what: "Una excepción para un modelo concreto. El precio que escribes es el FINAL de esa montura (o estuche): la regla general ya no se le aplica. Los precios son por modelo, no por color: todos los colores de esa montura valen lo mismo. La lista «Modificados» es, a propósito, corta: solo lo que se sale de la regla.",
    how: [
      "Escribe dos letras o más del modelo en «Buscar montura o estuche…» y elígelo de los resultados.",
      "Escribe el precio y pulsa Guardar. Aparece en «Modificados» con su precio base al lado, para comparar.",
      "Para devolverlo a la regla, pulsa «Quitar» en su fila. No se borra nada: vuelve a seguir la regla.",
      "Con una tienda elegida arriba, el precio es solo de esa tienda; las filas que digan «Heredado» son las del maestro que esa tienda no ha cambiado.",
    ],
    why: "Hay monturas que no admiten la regla: una muy barata que el margen deja ridícula, una exclusiva, una en liquidación. Esto resuelve el caso sin romper el sistema.",
    example: "La regla es +35 %, pero la montura de piloto de $60 la quieres a $99 fijos: la buscas, escribes 99 y queda en «Modificados».",
    pitfalls: [
      "Poner precios propios a decenas de modelos: si pasa, lo que está mal es la regla, no las monturas.",
      "Esperar que el precio propio suba cuando subas la regla: no sube, es un precio final.",
      "Buscar con una letra: hace falta un mínimo de dos para no traer el catálogo entero.",
    ],
  },
  "price.lensMatrix": {
    title: "La matriz de lentes: diseño × material",
    short: "La tabla de la lista 2026: cada fila es un diseño de lente y cada columna un material. El cruce es el precio del lente, que se suma al de la montura.",
    what: "El precio de un par de lentes sale de dos decisiones: QUÉ diseño (visión sencilla, bifocal, progresivo…) y EN QUÉ material (CR-39, policarbonato, 1.61, 1.67, 1.74). Cada casilla de la tabla es ese precio. Los tratamientos (fotocromático, antirreflejo) van aparte y se suman. El total que cobra el mostrador es montura + casilla + tratamientos.",
    how: [
      "Busca la fila del diseño y la columna del material, haz clic en el número y escribe el nuevo.",
      "Sale del campo (clic fuera o Enter) y se guarda. No hay un botón por casilla a propósito: así se repasa la tabla de corrido.",
      "Con «Todas las tiendas» estás cambiando el maestro, el precio de toda la cadena.",
      "Con una tienda elegida, lo que escribes es el precio de ESA tienda; queda resaltado y la ayuda del campo dice cuánto es en el maestro.",
    ],
    why: "Es la lista con la que se cotiza en el mostrador. Si una casilla está mal, se cobra mal todo el día y nadie lo nota hasta cerrar el mes.",
    example: "Visión sencilla en 1.67 cuesta $120. Subes el 1.67 a $130 y todas las ventas de ese material a partir de ahora cobran 10 más.",
    pitfalls: [
      "Cambiar el material equivocado por leer la columna de al lado: fíjate en la cabecera, se queda fija al desplazar.",
      "Escribir centavos sin punto (13000 en vez de 130.00).",
      "Creer que cambiar el maestro arregla una tienda que tiene porcentaje propio: ahí manda el porcentaje de la tienda.",
    ],
  },
  "price.photo": {
    title: "Fotocromáticos y Transitions",
    short: "El lente que se oscurece al sol. Se cobra aparte del lente, y el precio cambia según el diseño: sencillo, bifocal o progresivo.",
    what: "Un tratamiento que se añade al lente. La tabla tiene una fila por opción (Fotocromático Grey, Transitions Gen S, XTRActive…) y una columna por categoría de diseño, porque el mismo tratamiento cuesta distinto en un progresivo que en un monofocal. «No se ofrece» quiere decir que esa combinación no existe y el sistema no la cobra ni la vende.",
    how: [
      "Elige la fila de la opción y la columna de la categoría (visión sencilla, bifocal, progresivo) y escribe el precio.",
      "Sale del campo y se guarda, igual que la matriz.",
      "Con una tienda elegida, el precio es el de esa tienda; sin precio propio, sigue el porcentaje general de la tienda.",
    ],
    why: "Es de lo que más se vende como añadido y de lo que más se equivoca en el mostrador. Tenerlo por categoría evita cobrar un progresivo fotocromático a precio de monofocal.",
    example: "Transitions Gen S Grey cuesta $105 en los tres diseños; el Fotocromático Brown no se ofrece en visión sencilla, así que esa casilla dice «No se ofrece».",
    pitfalls: [
      "Poner precio en una casilla «No se ofrece» para «dejarla por si acaso»: se empieza a vender algo que el laboratorio no hace.",
      "Confundir fotocromático genérico con Transitions: son productos y precios distintos.",
    ],
  },
  "price.ar": {
    title: "Antirreflejo (AR)",
    short: "La capa que quita los reflejos y los halos de noche. Hay dos grupos: los de visión sencilla y los de bifocal y progresivo.",
    what: "El antirreflejo es un tratamiento con varias calidades (básico, plus, azul, Crystal, Flawless…). El sistema los agrupa por a qué lentes se les puede poner: «visión sencilla» o «bifocal y progresivo». Cada uno tiene un precio que se suma al lente y a los fotocromáticos.",
    how: [
      "Escribe el precio al lado de cada antirreflejo y sal del campo.",
      "Con una tienda elegida, el precio es el de esa tienda; la pastilla dice cuánto es en el maestro.",
    ],
    why: "Es el añadido con más margen de la venta. Un AR mal puesto en la lista se cobra de menos cientos de veces antes de que alguien revise.",
    example: "AR Green Básico $60 para visión sencilla; Flawless $120 para progresivos.",
    pitfalls: ["Poner un AR del grupo de progresivos a precio de monofocal: son capas distintas y el laboratorio cobra distinto."],
  },
  "price.progressive": {
    title: "Los progresivos con nombre y su gama",
    short: "Purity Basic, DVG Distinct, DVG Camber… son diseños de progresivo con nombre propio. La pastilla dorada dice su gama y debajo para quién es.",
    what: "Además de «progresivo gama media» y «gama alta», la lista 2026 tiene nueve progresivos digitales con nombre. Cada uno lleva su gama (Básico, Intermedio, Avanzado, Premium, Premium superior, Elite) y una nota de uso («conducción frecuente», «oficina y computadora»). El precio «desde» es el de CR-39, policarbonato, 1.56 y 1.61; el 1.67 y el 1.74 suben un escalón según la gama.",
    how: [
      "Lee la gama en la pastilla de la fila y el uso debajo del nombre: es lo que se le dice al cliente en el mostrador.",
      "Cambia el precio de cada material en su columna, como en el resto de la matriz.",
    ],
    why: "Recomendar por gama y por uso es lo que sube el ticket sin presionar: el cliente que conduce de noche entiende por qué le conviene el DVG Drive.",
    example: "DVG Camber es gama Elite, «máxima tecnología»: desde $300, y en 1.74 son $390.",
    pitfalls: ["Vender un progresivo de oficina para la calle: el campo lejano es corto y el cliente lo devuelve."],
  },
  "price.storeVariation": {
    title: "El precio de lentes de UNA tienda (% sobre el maestro)",
    short: "Un solo porcentaje sube o baja todos los lentes de esa tienda sobre la lista general. Si a una casilla le pones precio exacto, ese precio manda.",
    what: "Cada tienda vende desde el mismo maestro, pero puede tener su propio nivel de precios (una tienda en zona más cara, una de consignación). En vez de cargar una lista por tienda, se pone un porcentaje: +10 % cobra un 10 % más que el maestro en TODOS los lentes. Y si una casilla concreta tiene que valer un número exacto, se escribe en la matriz y esa casilla ignora el porcentaje.",
    how: [
      "Elige la tienda arriba, en el selector.",
      "En «Lentes», escribe el porcentaje en «% sobre el maestro» y guarda. Vacío = el maestro, sin cambios.",
      "Para una casilla concreta, escríbela en la matriz: queda resaltada y la pastilla cuenta cuántas casillas tienen precio propio.",
      "Los precios de montura por tienda se ponen igual, en «Monturas y estuches», con la tienda elegida.",
    ],
    why: "Es lo que el dueño pidió: «cada tienda maneja sus precios por separado, no subiendo ficheros, sino desde ese único maestro con variaciones». Así el maestro sigue siendo uno y nadie trabaja con una lista vieja.",
    example: "El maestro cobra $100 el monofocal 1.56. La tienda con +10 % cobra $110. A esa misma tienda le pones el 1.74 en $170 exactos: el 1.74 es 170, el resto sigue con el +10 %.",
    pitfalls: [
      "Poner el porcentaje con «Todas las tiendas» elegido: ahí no hay porcentaje, se edita el maestro.",
      "Olvidar que una casilla con precio propio no sube cuando subes el porcentaje.",
    ],
  },
  "price.commission": {
    title: "La comisión de quien vende",
    short: "El porcentaje del neto de cada venta que se lleva el vendedor. Es un costo real: ya está restado de la ganancia.",
    what: "Cada vendedor tiene su porcentaje. Se aplica al NETO de la venta (lo pagado menos envío, impuestos y la comisión del cobro), no al total con impuestos. La «comisión por defecto» es con la que arranca quien no tenga una propia. Cambiar un porcentaje recalcula también las ventas pasadas, porque la ficha de costo se computa con las reglas de hoy.",
    how: [
      "Escribe el porcentaje por defecto y, debajo, el de cada persona.",
      "Pulsa «Guardar comisiones»: solo se manda lo que cambiaste, y cada cambio queda en la auditoría.",
    ],
    why: "Es dinero que sale de cada venta. Pagarlo sobre otra base (el total con impuestos, por ejemplo) descuadra el margen del mes.",
    example: "Venta con neto $251 y vendedor al 5 % → $12.55 de comisión, ya restados de la ganancia de esa venta.",
    pitfalls: [
      "Pagar sobre lo que entró en caja: la comisión se calcula sobre lo vendido en el período, no sobre lo cobrado.",
      "Subir un porcentaje y sorprenderse de que el margen del mes pasado baje: el pasado se recalcula.",
    ],
  },
  "price.costToggle": {
    title: "Apagar un costo en una tienda",
    short: "Cada tienda puede desactivar los costos que no paga (una que no paga renta, otra sin laboratorio propio). Sin tocar la lista general.",
    what: "Las reglas de costo son la plantilla del dueño: lo que cuesta una montura de tal marca, lo que cobra el laboratorio, el porcentaje de la pasarela de pago. No todas las tiendas pagan todas. El interruptor de cada fila apaga ese costo SOLO en la tienda elegida arriba; el resto sigue cobrándolo y la lista general no cambia.",
    how: [
      "Elige la tienda arriba. Sin tienda elegida los interruptores están en gris: una tienda es la que decide.",
      "Quita la casilla del costo que esa tienda no paga. La fila se tacha y dice «Apagado en esta tienda».",
      "Vuelve a marcarla para cobrarlo otra vez. Cada cambio queda en la auditoría con el antes y el después.",
    ],
    why: "Sin esto, o le cargas a una tienda una renta que no paga (y su resultado sale peor de lo real), o se la quitas a todas (y las que sí pagan parecen más rentables).",
    example: "La tienda del centro comercial paga renta; la del local propio no. Apagas «Renta» en la segunda y su resultado del mes deja de arrastrar un costo inventado.",
    pitfalls: [
      "Apagar un costo para «que salga mejor el mes»: el número deja de servir para decidir.",
      "Apagar la comisión del cobro: eso lo cobra la pasarela aunque tú lo apagues.",
    ],
  },
  "price.tax": {
    title: "El impuesto de las monturas sin receta",
    short: "Solo se cobra cuando la compra no lleva receta: los lentes recetados están exentos. Es el mismo porcentaje que usa el mostrador y la tienda web.",
    what: "En este estado los anteojos con receta no llevan impuesto de venta, pero una montura sola (gafas de sol sin graduar, un armazón suelto, un estuche) sí. Este porcentaje es el que se aplica a esas ventas. Se guarda una sola vez y lo leen el punto de venta, el carrito de la web y la ficha de costo.",
    how: [
      "Escribe el porcentaje (7.25 para 7.25 %) y pulsa Guardar.",
      "Si la pastilla dice «Valor del entorno», es que todavía viene de la configuración del servidor: al guardar aquí pasa a mandar este número.",
    ],
    why: "Cobrar impuesto a un lente recetado es cobrarle de más al cliente; no cobrarlo a una montura sola es pagarlo tú al declarar.",
    example: "Impuesto 8.25 %: unas gafas de sol de $40 se cobran a $43.30; los mismos $40 con receta se cobran $40.",
    pitfalls: [
      "Escribir 0.0825 en vez de 8.25.",
      "Cambiarlo sin que lo diga la contadora: es el número con el que se declara.",
    ],
  },
};

const TOPICS_EN = {
  /* ─────────────── The prescription ─────────────── */
  "pos.rx.howToRead": {
    title: "How to read a paper prescription",
    short: "A prescription has two rows (OD = right eye, OS = left eye) and columns of numbers. Copy each number into the box with the same name.",
    what: "The prescription is the eye doctor's note with each eye's \"power\": how much the sight needs correcting. It always has two rows, one per eye: OD (right eye, sometimes \"R\" or \"O.D.\") and OS or OI (left eye, \"L\", \"O.S.\"). The columns are usually SPH (sphere), CYL (cylinder), AXIS, ADD and sometimes PD and SH. This screen uses the same names so it is just copying.",
    how: [
      "Find the prescription date and type it in \"Date\": a prescription older than 1–2 years (depending on the state) can no longer be used to make lenses.",
      "Find the OD row (right) and copy SPH, CYL and AXIS from left to right. Do the same for the OS row.",
      "Keep the sign: \"−\" is nearsightedness, \"+\" is farsightedness. A number without a sign is taken as positive; if in doubt, ask.",
      "If there is an ADD column with a value (for example +2.00), the prescription is multifocal: switch the type above and enter it.",
      "If the prescription includes PD or a height, copy them; if not, they are measured here in the store.",
      "When a box on the paper says \"Plano\", \"PL\", \"Sph\" or \"—\", it means zero: leave the box at 0.00 or empty.",
    ],
    why: "A number in the wrong row or with the wrong sign makes lenses the customer cannot wear: they must be remade and the store loses the lab money. Copying calmly is worth more than going fast.",
    example: "Prescription: OD −2.25 −0.50 × 180 · OS −2.00 −0.75 × 175 · ADD +2.00 · PD 63. It is multifocal (it has ADD). Sphere −2.25 and −2.00, cylinder −0.50 and −0.75, axes 180 and 175, add +2.00 in both eyes and 31.5 mm PD per eye.",
    pitfalls: [
      "Mixing up OD and OS: the customer's right eye is the one on YOUR left when you face them.",
      "Reading \"×\" or \"x\" as a multiplication: it only separates the cylinder from the axis.",
      "Forgetting the cylinder sign: it is almost always negative on optometrist prescriptions.",
    ],
  },
  "pos.rx.type": {
    title: "Single vision or multifocal",
    short: "Single vision: one power only (for distance or for near). Multifocal: distance and near in the same lens; the prescription has an ADD.",
    what: "A single-vision lens has the same power across the whole lens and works for one distance: far (driving, TV) or near (reading). A multifocal puts distance at the top and near at the bottom: bifocal (with a visible line) or progressive (no line, smooth change). Multifocals are for people who already need help to read, usually from age 40–45.",
    how: [
      "Look at the prescription: if there is a value under ADD (for example +1.50), choose \"Multifocal\".",
      "If there is no ADD, choose \"Single vision\".",
      "If the customer says they want \"reading glasses\" and the prescription has an ADD, a near single-vision lens is also possible: ask the doctor or the manager before deciding.",
      "Switching the type shows or hides the ADD and SH columns; nothing already typed is lost.",
    ],
    why: "The type decides which lenses can be sold (the \"Lenses\" step only shows compatible ones) and which measurements are required: a progressive without a fitting height comes back wrong from the lab.",
    pitfalls: [
      "Choosing single vision when the prescription has an ADD: the system warns, but better to check first.",
      "Selling a progressive to someone who has never worn one without explaining it takes a few days to get used to.",
    ],
  },
  "pos.rx.sph": {
    title: "Sphere (SPH)",
    short: "The main power of each eye. Negative (−) for poor distance vision (nearsighted), positive (+) for poor near vision (farsighted). Always in 0.25 steps.",
    what: "The sphere says how much the image must be \"pushed\" so the eye can focus. A negative number corrects nearsightedness (poor far vision); a positive one corrects farsightedness (poor near vision or eye strain). The further from zero, the stronger the power and the thicker the lens. It is measured in diopters and always in 0.25 steps: −1.75, −2.00, −2.25… never −2.10.",
    how: [
      "Copy the number from the SPH (\"Sphere\") column of the matching eye's row, with its sign.",
      "If the paper says \"Plano\", \"PL\" or \"0\", type 0.00.",
      "When you leave the box the value is formatted like the lab sheet (−2 → −2.00).",
      "Accepted values: from −20.00 to +12.00. Beyond that the system asks you to check.",
    ],
    why: "It is the number that most affects the customer's sight and the price: from ±4.00 up a thinner material is advisable (see \"Lenses\"). A wrong sign makes useless lenses.",
    example: "OD −3.25 means: right eye, nearsighted by three and a quarter diopters.",
    pitfalls: [
      "Forgetting the sign: \"2.00\" on its own is saved as +2.00, which may not be what the paper said.",
      "Typing the axis or the cylinder in the sphere box.",
    ],
  },
  "pos.rx.cyl": {
    title: "Cylinder (CYL)",
    short: "Corrects astigmatism (the image looks stretched or blurry in one direction). It always comes with an AXIS.",
    what: "Astigmatism happens when the front of the eye is not perfectly round but slightly oval, and the person sees lines or letters distorted. The cylinder is how much that must be corrected, also in 0.25 steps and with a sign (almost always negative on optometrist prescriptions). If the box is empty, there is no astigmatism.",
    how: [
      "Copy the number from the CYL (\"Cyl\", \"Cylinder\") column with its sign.",
      "If there is a cylinder, the AXIS is required: type it next.",
      "If there is no cylinder, leave the box empty; the axis locks by itself.",
      "Accepted values: from −6.00 to +6.00.",
    ],
    why: "A cylinder without an axis is like a street without a house number: the lab cannot make the lens. That is why the system does not let you go on.",
    example: "OS −0.75 × 90: the left eye has 0.75 of astigmatism at axis 90.",
    pitfalls: [
      "Typing the cylinder as positive when the prescription has it negative (or the other way round): the result is a different lens.",
      "Leaving the axis empty \"because it is small\": a −0.25 also has an axis.",
    ],
  },
  "pos.rx.axis": {
    title: "Axis",
    short: "The direction (1 to 180 degrees) in which the cylinder is placed. It only exists when there is a cylinder.",
    what: "The axis is an angle, like the hand of a clock: from 1 to 180 degrees. It tells which direction the eye's astigmatism lies in so the lab can orient the cylinder. No decimals, no sign. On the prescription it appears after an \"×\" or under the \"Axis\" column.",
    how: [
      "Copy the whole number that follows the cylinder (for example \"× 180\" → 180).",
      "If the paper says \"0\", type 180: they are the same and the system uses 180.",
      "If there is no cylinder, the box is locked: there is nothing to type.",
    ],
    why: "An axis off by a few degrees already causes dizziness and double vision with high powers. It is the most common reason lenses go back to the lab.",
    pitfalls: [
      "Typing the axis with decimals or a sign.",
      "Swapping one eye's axis for the other's: they are often similar but not equal.",
    ],
  },
  "pos.rx.add": {
    title: "Add (ADD)",
    short: "The extra help for near vision in multifocal lenses. It is a positive value and is usually the same for both eyes.",
    what: "With age the eye loses its ability to focus up close (called presbyopia). The add is how much is added to the distance power for the reading zone of the lens. It is always positive, from +0.75 to +4.00, and on almost every prescription it is the same for both eyes: that is why here you type it in one eye and it copies itself to the other.",
    how: [
      "Choose \"Multifocal\" above so the ADD column appears.",
      "Copy the value from the ADD (\"Add\", \"Near add\") column with a + sign.",
      "If the paper has one value per eye and they differ, type each one.",
      "If the prescription has no ADD, the right type is \"Single vision\".",
    ],
    why: "Without an add a bifocal or progressive cannot be made, and with a miscopied add the customer will not be able to read with the new glasses.",
    example: "ADD +2.25 in a 55-year-old is typical; +0.75 is usual for someone just starting (40–45).",
    pitfalls: [
      "Typing it negative: the add always adds.",
      "Confusing it with a near sphere: if the prescription gives \"near\" as a full power, ask the manager to convert it.",
    ],
  },
  "pos.rx.prism": {
    title: "Prism",
    short: "Rare. Corrects eyes that do not point at the same spot (double vision). Only enter it if the doctor wrote it.",
    what: "A prism shifts the image so both eyes work together when one drifts slightly. It is measured in \"prism diopters\" (0 to 10, in 0.25 steps) and always has a direction, the \"base\". Most prescriptions do not have it; when present it appears as \"Prism\" or a triangle (Δ).",
    how: [
      "If the prescription does not mention a prism, leave the box empty.",
      "If it does, copy the number into PRISM and pick the BASE it states (up, down, in, out).",
      "Tell the manager: lenses with prism take longer at the lab and may change the price.",
    ],
    why: "A missing or reversed prism causes double vision or headaches. Because it is rare, the typical mistake is typing something here by confusion with another column.",
    pitfalls: [
      "Putting the PD or the axis in the prism box.",
      "Copying the prism without its base: the system asks for both.",
    ],
  },
  "pos.rx.base": {
    title: "Prism base",
    short: "Which way the prism points: up, down, in (towards the nose) or out (towards the temple). Only active when there is a prism.",
    what: "The base is the thick part of the prism and sets the direction the image moves. On the prescription it appears as \"BU/BD\" (base up/down) or \"BI/BO\" (base in/out). No prism, no base.",
    how: [
      "Type the PRISM value first; the BASE box unlocks.",
      "Pick the direction the prescription states. \"In\" = towards the nose; \"out\" = towards the ear.",
    ],
    why: "The same prism with the base reversed makes the problem worse instead of fixing it.",
    pitfalls: ["Assuming one eye's base is the same as the other's: they are often opposite (one in, one out)."],
  },
  "pos.rx.pd": {
    title: "Pupillary distance (PD)",
    short: "Millimeters from the center of the nose to each eye's pupil. Usually between 25 and 35 mm per eye (50–70 in total).",
    what: "The binocular PD is the distance between the two pupils; the monocular PD is each half, measured from the center of the nose to each pupil, because many faces are not symmetrical. Here you type one per eye; the sum (binocular PD) shows below. It makes sure the optical center of the lens sits right in front of the pupil.",
    how: [
      "If the prescription already has a PD (for example \"63\"), divide by 2 and type 31.5 in each eye; if it has two numbers (32/31), type each in its eye.",
      "To measure: face the customer at the same height, about 40 cm away. Rest a millimeter ruler on their nose.",
      "Close your right eye and ask the customer to look at your open left eye; line up the ruler's 0 with the center of their right pupil.",
      "Without moving the ruler, close your left eye, open your right and read the millimeter at the center of their left pupil: that is the total PD.",
      "For the per-eye PD, measure from the center of the bridge of the nose to each pupil. Repeat, and if the two eyes differ by more than 4 mm, measure again.",
    ],
    why: "If the lens center does not match the pupil the customer sees blurry or with a prism effect and feels dizzy, even with the right power. With progressives it matters even more.",
    example: "Typical adult: 31 + 32 = 63 mm. Child: 27 + 27 = 54 mm.",
    pitfalls: [
      "Typing the total PD (63) in one eye: the system rejects more than 40 mm per eye.",
      "Measuring with the customer looking far away for reading glasses (near PD is about 3 mm smaller).",
    ],
  },
  "pos.rx.seg": {
    title: "Fitting height (SH)",
    short: "Millimeters from the bottom edge of the lens to the pupil, with the frame on. Required for multifocals (10–35 mm).",
    what: "In a bifocal or progressive the near zone sits in the lower part of the lens, and the lab must be told exactly where it starts. The fitting height (or \"segment height\") is the vertical distance, in millimeters, from the lowest edge of the rim to the center of the pupil, measured with the chosen frame on and properly adjusted. It is one measurement for both eyes.",
    how: [
      "Put the frame the customer is buying on them, centered and sitting well on the nose.",
      "Ask them to look straight ahead, relaxed, at your eye at their same height (sit or stand as they do).",
      "With a fine marker, mark the center of the pupil on the demo lens; or measure directly with the ruler from the bottom edge of the rim to the pupil center.",
      "Type the millimeters in SH. Below 14 mm the system warns: the progressive corridor would be very short and the design or frame should be confirmed.",
    ],
    why: "A height off by 2 mm makes the customer raise or lower their head to read and complain that they \"can't see well\": it is the number-one complaint on progressives, and the lab does not replace it for free.",
    example: "Frame with a 36 mm tall rim, pupil slightly above center: height ≈ 20 mm.",
    pitfalls: [
      "Measuring without the chosen frame on, or with it slid down the nose.",
      "Confusing it with the rim height (the frame's \"B\" measurement).",
    ],
  },
  "pos.rx.ocr": {
    title: "Read the prescription from a photo",
    short: "Take a photo or upload the file: the AI fills the grid. You must review and confirm it, box by box.",
    what: "Instead of typing, you can photograph the prescription (or upload an image or PDF you already have). An automatic reader recognizes the OD/OS rows, the numbers and the date and places them in the grid. It is a helper, not a substitute: the doctor's handwriting, a glare or a stamp can make it read a 3 as an 8.",
    how: [
      "Lay the prescription flat, in good light, with no shadows or fingers over it; the photo must be sharp.",
      "Press \"Take a photo\" (tablet or phone) or \"Upload a file\" and wait a few seconds.",
      "Compare every box with the paper: sign, number and axis. Fix anything that does not match.",
      "Press \"Confirm\" to record that you reviewed it. The sale stores \"Source: read from the photo\".",
    ],
    why: "It saves time and avoids typing errors, but you remain responsible for the prescription: an unreviewed automatic reading is the fastest way to order the wrong lenses.",
    pitfalls: [
      "Confirming without looking: the most common reading errors are the cylinder sign and the axis.",
      "Photographing an expired prescription: check the date the AI detected.",
    ],
  },
  "pos.rx.worn": {
    title: "What they wear today",
    short: "We record the power of the glasses the customer is wearing to compare it with the new prescription and see whether their sight changed.",
    what: "If the customer already wears glasses, in the \"Customer\" step their current power is recorded (read from their previous prescription, measured with the store's lensmeter or taken from a previous sale) and, optionally, the measurements of their current frame. It is not required to make the new lenses: it is information to advise better.",
    how: [
      "Tick \"Yes\" under \"Wears glasses?\".",
      "Choose where the power comes from: previous prescription, lensmeter or a previous purchase at the store (if one exists, it is proposed automatically).",
      "Type the power and, if you can, when it is from (exact date or \"X months ago\").",
      "Optional: measure the current frame (lens width, bridge, temple) to guide the choice of the new one.",
    ],
    why: "By comparing both powers the system warns of a significant optical change: it helps explain to the customer why they need new lenses, flags worsening that should be checked by the doctor, and leaves a record on the receipt.",
    pitfalls: [
      "Typing the new prescription here by mistake: this grid is for the old one.",
      "Making up the height: it is not required for what they wear today because the lensmeter does not give it.",
    ],
  },

  /* ─────────────── Making a sale ─────────────── */
  "pos.step.customer": {
    title: "Step 1 · Customer",
    short: "Search whether the customer already exists (phone, email or name) before creating them. Here you also note whether they wear glasses today.",
    what: "Every sale belongs to a person. In this step you find them or create them with name, phone, email and date of birth; the address is only needed if the order will be shipped home. If they already wear glasses, their current power is recorded (see \"What they wear today\").",
    how: [
      "Type part of the name, the phone or the email in the search box. If they appear, tap them: their data and history load.",
      "If they do not appear, fill in the form. First and last name are required; the email is used to send the receipt.",
      "Answer \"Wears glasses?\" and, if yes, fill in their current power.",
      "Press \"Next\".",
    ],
    why: "A duplicate customer splits their history across two records and the store loses track (balances, previous prescriptions, warranties). The phone number is the best key to find them.",
    pitfalls: [
      "Creating a new record without searching first.",
      "Mistyping the email: the receipt will not arrive and there will be no warning.",
    ],
  },
  "pos.step.frame": {
    title: "Step 2 · Frame",
    short: "Pick a frame from the store's inventory or register the one the customer brings. Only one per sale.",
    what: "The frame is the rim and temples. It can come from the store's catalog (search by name, brand or barcode; pick the color) or be the customer's own, when they only want new lenses. Each sale carries exactly one frame; for two pairs, make two sales.",
    how: [
      "From inventory: search by name or scan the barcode; pick the color and press \"Add\".",
      "The customer's own: press \"Customer's frame\", describe it (brand, color) and take a photo if you can.",
      "Check the frame card and, if you got it wrong, remove it with the trash icon and pick another.",
    ],
    why: "The frame sets the base price and, for multifocals, the fitting height. Registering the customer's own frame with a photo protects the store if there are doubts later about its condition.",
    pitfalls: [
      "Trying to add two frames: the system only allows one.",
      "Picking a color the store does not have in stock: check the availability on the card.",
    ],
  },
  "pos.ownFrame": {
    title: "Customer's frame",
    short: "The customer brings their own frame and only buys the lenses. Describe it and take a photo to record how it arrived.",
    what: "Many customers want to reuse a frame they already own. It is registered as \"customer's frame\" with a description and a photo; the sale only charges the lenses and the work. That frame takes the sale's single frame slot.",
    how: [
      "In the Frame step press \"Customer's frame\".",
      "Type the brand, color and any detail (loose temple, scratches…).",
      "Take a photo (on touch screens) or upload one from a file. It shows on the detailed receipt and the lab sheet.",
      "Press \"Save\". In the Prescription step a power will be required: someone else's frame without lenses is not a sale.",
    ],
    why: "Used frames can break when new lenses are fitted. The photo and description at intake avoid arguments later.",
    pitfalls: ["Ticking \"No prescription\" with a customer's frame: there is nothing to sell."],
  },
  "pos.step.lenses": {
    title: "Step 4 · Lenses",
    short: "Choose the lens type (single vision, bifocal, progressive), the material (thinner the higher the power), whether it is photochromic and the anti-reflective coating.",
    what: "The lenses are the glass that goes in the frame. Four things are chosen. Type: single vision (one distance), bifocal (distance and near with a line) or progressive (distance, intermediate and near with no line). Material: CR-39 (basic plastic, thick at high powers), polycarbonate (light and impact-resistant, ideal for kids and sport), 1.67 and 1.74 (progressively thinner and lighter, for high powers). Photochromic: darkens in the sun and clears indoors. Anti-reflective (AR): a coating that removes glare, improves night vision and looks better.",
    how: [
      "The type is already filtered by the prescription: single vision only for a single-vision Rx; bifocal or progressive for a multifocal one.",
      "Pick the material. The system marks the recommended one with ★ based on the highest power in the prescription: up to ±2.00 CR-39 is fine; ±2.00 to ±4.00 polycarbonate; ±4.00 to ±6.00 1.67; above ±6.00 1.74.",
      "Photochromic: ask whether the customer spends time outdoors or drives by day.",
      "Anti-reflective: always recommend it with computer use, night driving or high powers.",
      "If it is \"frame only\" (no lenses), pick that option under type.",
    ],
    why: "Material and coatings are most of the price and of the satisfaction: a thick lens in a thin frame looks bad, and a progressive without AR disappoints at night. Explaining the options sells better than imposing them.",
    example: "Prescription −5.50 in one eye: the recommendation is 1.67; with polycarbonate the edge would be very thick.",
    pitfalls: [
      "Selling polycarbonate at high powers to make it cheaper: the customer will come back because of the thickness.",
      "Forgetting the fitting height on progressives: the step will not let you go on without it.",
    ],
  },
  "pos.step.price": {
    title: "Step 5 · Price and discount",
    short: "The system computes the total. You can apply a discount up to your limit; beyond that it needs approval from a manager or the owner.",
    what: "Here you see each item's list price, taxes and the total, computed by the server (never by hand). The discount is typed as a percentage. Each person has a discount limit by role; if you exceed it, or an item drops below its minimum price, the sale is blocked until someone with permission approves it from their own panel.",
    how: [
      "Check the items and prices. If something is off, go back to the matching step.",
      "Type the discount (for example 10) if applicable. The total recalculates by itself.",
      "If \"Needs approval\" appears, write the reason and press \"Request approval\". Wait until it changes to \"Approved\" (the manager sees it under Approvals).",
      "If the new prescription differs a lot from what they wear today, an optical-change notice appears: mention it to the customer.",
    ],
    why: "Uncontrolled discounts eat the profit; approval leaves a record of who authorized each one and why. The minimum price protects the lab cost.",
    pitfalls: [
      "Typing the discount in money: the box is a percentage.",
      "Promising a price to the customer before checking whether it needs approval.",
    ],
  },
  "pos.step.payment": {
    title: "Step 6 · Payment",
    short: "Record how the customer pays (cash, card, Zelle, insurance…). They can leave a deposit and pay the rest at pickup. The receipt goes by email if you ask.",
    what: "The sale can be paid in full or in part. Each payment line has a method, an amount and, depending on the method, a reference (last 4 digits, confirmation number…). Whatever is missing stays as \"Balance due\" and is collected later from the sale. At the end the receipt prints (two copies on one letter sheet: customer and store) and, if there is an email, a simple one is sent; the detailed one (with prescription and photos) only if you tick it.",
    how: [
      "Check the sale summary. You can edit any step from there.",
      "Pick the payment method and type the amount; \"Rest\" fills in what is missing. With cash, type what the customer hands over to see the change.",
      "For a deposit, type only that amount: the balance stays pending and shows on the receipt.",
      "If they pay with two methods, press \"Another payment\".",
      "Choose store pickup or shipping (shipping needs the customer's address).",
      "Tick \"Email the receipt\" if the customer wants it, and \"with details\" only if they asked to see the prescription and photos.",
      "Press \"Charge and record\". The receipt sheet opens for printing.",
    ],
    why: "The money that comes in here is what balances the till later: a wrong method (a card recorded as cash) throws off the day's closing. The pending balance tells the store what is left to collect at delivery.",
    pitfalls: [
      "Charging more than the total: the system blocks it.",
      "Forgetting the card or Zelle reference when the method asks for it.",
    ],
  },

  /* ─────────────── Executive panel ─────────────── */
  "exec.overview": {
    title: "Executive panel",
    short: "The business snapshot for a period: how much was sold, how much came in, how much it cost and how much was left. Tap any figure to drill down.",
    what: "This is the screen for the owner and the managers. At the top you choose store and period; in the middle the main indicators (KPIs); below, accordions with the orders, the till, the sellers and the costs for the same period. Every card can be exported to Excel, CSV or PDF.",
    how: [
      "Pick the store (or all) and the period (today, week, month or a range).",
      "Read the KPIs left to right: sales → collected → balance due → cost → profit → margin.",
      "Open the accordions to see where the numbers come from; click a KPI to go to the screen that explains it.",
      "For a meeting, use \"Excel\" or \"PDF\" in the bar: it includes the applied filters.",
    ],
    why: "Looking at this every week with the same period shows trends (the \"vs. previous period\") and catches early a store that sells but does not collect, or collects but does not earn.",
  },
  "exec.period": {
    title: "Period",
    short: "The dates being added up. The whole panel (KPIs, orders, till) changes at once.",
    what: "The period bounds which sales and payments enter the numbers. \"Today\", \"This week\", \"This month\" are shortcuts; \"Range\" allows any two dates. The \"vs. previous period\" comparison uses a stretch of equal length right before.",
    how: [
      "Tap a shortcut, or pick \"Range\" and type from/to.",
      "Check that the \"to\" date includes the whole day (it does: until 23:59).",
    ],
    why: "Comparing periods of different length leads to false conclusions. To see growth, compare month with month or week with week.",
    pitfalls: ["Reading \"Balance due\" as if it were for the period: that KPI is today's pending balance, whenever it comes from."],
  },
  "exec.storeFilter": {
    title: "Store filter",
    short: "Pick one store or all. A manager or seller only sees their own; the owner sees all plus the online store.",
    what: "Every sale belongs to a physical store (or to the web). This filter is global for the whole panel: it is remembered across tabs and tints the header with the chosen store's color so you always know where you are.",
    how: [
      "Open the selector and pick the store, \"All\" or \"Web\".",
      "With \"All\", the accordions show an extra column with each row's store.",
    ],
    why: "Comparing stores over the same period is the fastest way to see which one needs attention. And it avoids the classic mistake of balancing one store's till against everyone's sales.",
  },
  "exec.kpi.sales": {
    title: "Sales",
    short: "Everything sold in the period, taxes included and discounts already subtracted. Voided sales do not count.",
    what: "The sum of the totals of the sales recorded in the period (sale date, not payment date). It includes what has not yet been fully collected. Below it shows the change versus the previous period.",
    how: ["Click the KPI to open the Sales board, where it is broken down by day, seller and product."],
    why: "It is the activity figure: if it rises but \"Collected\" does not, the store is extending too much credit.",
    pitfalls: ["Comparing it with what came into the till: they are different things (see \"Collected\")."],
  },
  "exec.kpi.collected": {
    title: "Collected",
    short: "What the period's sales have collected so far: deposits and later payments on store sales, and the total of web orders (paid at checkout).",
    what: "It is counted by SALE date: for each sale of the period it adds what has already been collected (deposit and any later payment). The rest a customer pays today for last month's sale adds to last month, not to today. The insurer's part does not count here. The money that came into the till during the period, whatever sale it belongs to, is in \"Cash on hand\" and the Cash report.",
    how: ["Click to go to the Till and see payments by method (cash, card, Zelle…)."],
    why: "This is what can be deposited at the bank. High sales with low collections mean pending balances to chase.",
  },
  "exec.kpi.balance": {
    title: "Balance due",
    short: "What the period's sales still owe TODAY. What is owed on sales from any date is \"Money on the street\".",
    what: "For the non-voided sales of the period and the chosen store(s), adds the balance each one owes today. A deposit leaves the rest here until the customer picks up and pays; once they pay, it drops in past periods too. To see what is owed whatever the sale date, look at \"Money on the street\" or Pending balances.",
    how: ["Click to see the list of sales with a balance and collect from each one."],
    why: "Money the store already spent at the lab and has not received yet. If it grows month after month, the deposit policy needs a look.",
  },
  "exec.kpi.cost": {
    title: "Real cost",
    short: "What it cost to produce what was sold: frames and lenses (Costs rules), fixed per-order items and the payment fee. Only visible to people allowed to see costs.",
    what: "Every sale has a cost computed from the rules in the Costs tab: the frame's purchase price, the lab cost by lens type and material, fixed per-order items (case, shipping to the lab) and the fee charged by the payment method (card, Zelle). If a sale is missing a rule, the KPI says how many.",
    how: [
      "If \"N sales with an undefined cost\" appears, click it: it takes you to the rules to complete them.",
      "Current rules also apply to the past: changing one changes the cost of previous months.",
    ],
    why: "Without cost there is no real profit: a store can sell a lot and lose money through an expensive lab or discounts. That is why only the owner, superadmins and anyone with the \"view costs\" privilege see it; sellers do not.",
    pitfalls: ["Taking the cost as total expenses: rent, utilities and wages are in the store statement, not here."],
  },
  "exec.kpi.profit": {
    title: "Gross profit",
    short: "Sales before tax − real cost − seller commission. Before rent, wages and the other monthly expenses.",
    what: "What is left of each sale after paying what it cost to produce it and the seller's commission. It does not subtract the premises' expenses (rent, utilities, payroll): those are subtracted in the store statement. Shown with the change versus the previous period.",
    how: ["Click to see the profit breakdown per sale under Costs → Profit."],
    why: "It is the number that says whether selling more is actually worth it. A negative gross profit in a period points to excessive discounts or outdated costs.",
  },
  "exec.kpi.margin": {
    title: "Margin",
    short: "What percentage of each sale (before tax) stays as gross profit.",
    what: "Margin = gross profit ÷ sales before tax × 100. It lets you compare stores or months of different size: a 55% margin on small sales can be a better business than 30% on large ones.",
    how: ["Compare the margin across stores and periods; if it drops, look at discounts first and then at lab costs."],
    why: "In optical retail a healthy gross margin is usually between 50 and 65%. Below 40%, prices or suppliers need reviewing.",
  },
  "exec.orders": {
    title: "Store orders",
    short: "The list of sales in the period with their cost, profit and what was collected. This is where the KPIs above come from.",
    what: "Each row is a sale: number, date, customer, seller, total, collected, pending and, for those allowed, cost and profit. Voided ones appear struck through and do not add up.",
    how: [
      "Open the accordion and use the search or the column sorting.",
      "Click a sale to open it: from there you collect the balance, resend the receipt or print the lab sheet.",
      "Export to Excel to reconcile with the bank or the lab.",
    ],
    why: "It is the source of truth: if a KPI looks odd, here you see which sale explains it.",
  },
  "exec.ordersPlain": {
    title: "Store orders",
    short: "The list of sales in the period: each one's total, collected and pending. This is where the KPIs above come from.",
    what: "Each row is a sale: number, date, customer, seller, total, collected and pending. Voided ones appear struck through and do not add up. Cost and profit are shown only to those with the «View costs» permission, which is why they are not here.",
    how: [
      "Open the accordion and use the search or the column sorting.",
      "Click a sale to open it: from there you collect the balance, resend the receipt or print the lab sheet.",
      "Export to Excel to reconcile with the bank or the lab.",
    ],
    why: "It is the source of truth: if a KPI looks odd, here you see which sale explains it.",
  },
  "exec.overviewPlain": {
    title: "Executive panel",
    short: "The business snapshot for a period: how much was sold, how much came in and how much is still owed. Tap any figure to drill down.",
    what: "At the top you choose store and period; in the middle the sales and collection indicators (KPIs); below, accordions with the orders, the till and the sellers for the same period. Cost, profit and margin are shown only to those with the «View costs» permission. Every card can be exported to Excel, CSV or PDF.",
    how: [
      "Pick the store (or all) and the period (today, week, month or a range).",
      "Read the KPIs left to right: sales → collected → balance due.",
      "Open the accordions to see where the numbers come from; click a KPI to go to the screen that explains it.",
      "For a meeting, use «Excel» or «PDF» in the bar: it includes the filters applied.",
    ],
    why: "Looking at this every week with the same period shows trends (the «vs. previous period») and catches early a store that sells but does not collect.",
  },
  "exec.cash": {
    title: "Till for the period",
    short: "Payments grouped by method (cash, card, Zelle…) plus manual cash in and out.",
    what: "Shows, for the chosen period and store, how much came in by each method, refunds, the fee each method charges and the net; and below, the manual cash movements (supplier payments, bank deposits, withdrawals…). \"Cash on hand\" is cash collected + cash in − cash out.",
    how: [
      "Compare the net cash with what was deposited at the bank: they should match except for the change fund.",
      "Click to go to the Till and see each day's closings.",
    ],
    why: "Cash is what gets lost most easily by accident (and sometimes on purpose). Checking it against closings and deposits is a store's basic control.",
  },

  /* ─────────────── Cash till ─────────────── */
  "cash.session": {
    title: "Opening and closing the till",
    short: "At the start of the day the till is opened with the change fund; at the end the cash is counted and the till closed. The system compares the count with the expected amount.",
    what: "A \"till session\" is a shift: it starts when you open with the starting money (fund to give change) and ends when you close by counting what is there. During the session cash payments and manual movements add up. On closing, the system computes what should be there (expected) and shows the difference from the count.",
    how: [
      "Open: pick the terminal, type the starting fund (for example 100) and press \"Open till\".",
      "During the day, record any money that comes in or goes out without being a sale (see \"Movements\").",
      "Close: count all the cash in the drawer, type it under \"Counted\", add a note if there is a difference and press \"Close till\".",
      "If the difference is not zero, the system asks you to confirm it: it is recorded under your name.",
    ],
    why: "Without opening and closing there is no way to know whether money is missing or when it went missing. A till left open from yesterday also blocks today's.",
    example: "Fund 100 + cash sales 850 − supplier payment 200 = expected 750. Counted 745 → difference −5.",
    pitfalls: [
      "Leaving the till open for several days: differences become impossible to trace.",
      "Closing without counting and typing the expected amount: the till always \"balances\" and is useless.",
    ],
  },
  "cash.movement": {
    title: "Cash movements",
    short: "Money that goes into or out of the drawer without being a sale: paying a supplier, taking a deposit to the bank, an owner withdrawal… Always with a reason and a note.",
    what: "A movement is cash in or out that does not come from charging a customer. It has a kind (in/out), an amount, a reason from the list and a free note. Reasons: supplier payment, expense (e.g. cleaning), owner withdrawal, bank deposit, change fund, customer refund, correction of a mistake and other.",
    how: [
      "With the till open, pick In or Out.",
      "Type the amount, pick the reason and write a specific note (\"invoice 1234 from Supplier Optics\").",
      "Press \"Record\". The till's expected amount updates immediately.",
    ],
    why: "Every bill that leaves unrecorded shows up at closing as \"money missing\". The note is what lets you understand, weeks later, what happened.",
    pitfalls: [
      "Using \"Other\" for everything: reports group by reason and \"Other\" explains nothing.",
      "Recording a refund as cash out without voiding it on the sale: the sale will still count as collected.",
    ],
  },
  "cash.report": {
    title: "Till report",
    short: "Summary of a period: payments by method, manual movements, closings with their differences and cash day by day. Exports to Excel or PDF.",
    what: "The history of a store's till. For the chosen period it shows: how much came in by each payment method; the manual movements with reason and who made them; each closing with expected, counted and difference; and a chart by day. It can be filtered by person.",
    how: [
      "Pick the period (today, week, month or range) and, if you want, the person.",
      "Open \"Closings\" to see the differences: a repeated difference on the same shift deserves a conversation.",
      "Export to Excel for the accountant or to PDF to file.",
    ],
    why: "It is the document that reconciles the store with the bank and answers \"where is the money from such-and-such day?\".",
  },

  /* ─────────────── Reports ─────────────── */
  "statement.what": {
    title: "Store statement",
    short: "A store's monthly summary: sales, payments by method, by seller and by day. For partner stores it includes the settlement (their share).",
    what: "Each month a statement is generated per store, numbered EST-<store>-<YYYYMM>. It summarizes the month's sales (voided ones listed separately), payments by method, the split by seller and by day. If the store is a partner's or on consignment, the settlement appears at the end: the base (sales before tax) times the percentage agreed with that store.",
    how: [
      "Pick the store and the month (this one, the previous one or a range).",
      "Review each section; voided sales are shown separately so there are no surprises.",
      "Press \"PDF\" to hand it over or send it to the partner; \"Excel\" for the accountant.",
    ],
    why: "It is the document signed with the partner or used to pay taxes. Having it be the same every month, generated by the system, avoids disputes.",
    pitfalls: ["Generating it before the last day of the month is closed: payments will be missing."],
  },
  "salesboard.what": {
    title: "Sales board",
    short: "How much was sold and how much was earned, by hour, day, week, month or year, and by store, seller or product. Click a row to drill down.",
    what: "The tool for analyzing sales: a trend chart and tables by store, seller, brand, product or lens type. Every row can be \"focused\": tapping a seller makes the whole board show only their sales, and so on down to the list of individual sales. Sellers only see their own; cost and profit only those with permission.",
    how: [
      "Pick the period and the time unit (see \"View by\").",
      "Tap a store, then a seller, then a product: the chips at the top show the active filter; remove them with the ×.",
      "Turn on \"Compare\" to see the previous period alongside.",
      "Export the view to Excel with all filters applied.",
    ],
    why: "It answers concrete questions: which seller sells the most progressives? at what hour do most people come in? which brand leaves the most margin?",
  },
  "salesboard.grain": {
    title: "View by (hour, day, week…)",
    short: "The time unit of the chart. By hour to see the day's rhythm; by day or week for a month; by month for a year.",
    what: "Defines how the timeline is grouped. \"Hour\" shows the day across its hours (useful for shifts); \"Day\" and \"Week\" (Monday to Sunday) for a month; \"Month\" and \"Year\" for long periods. Options that make no sense for the chosen period are disabled.",
    how: ["Pick the period and then the unit. If you pick none, the system uses the most sensible one."],
    why: "Looking at a year by days is noise; looking at a week by months says nothing. The right unit makes the trend visible.",
  },

  /* ─────────────── Settings ─────────────── */
  "stores.color": {
    title: "Store color",
    short: "Each store has its own color. It shows in internal emails, in the panel header and in reports so you can tell at a glance which store something belongs to.",
    what: "When a store is created it is automatically given a color no other store has; you can change it to one from the palette or any other. It is used as a stripe in sales and alert emails, as a circle next to the subject (inboxes do not show colors), in the panel when you filter by that store and in the statement. The customer's receipt does not carry it.",
    how: [
      "On creation: accept the proposed color or pick another swatch.",
      "To change it: Stores → Edit → pick a swatch or use the color picker.",
      "Avoid two stores with similar colors: the system does not prevent it, but it is confusing.",
    ],
    why: "With several stores, the color is the fastest cue to avoid balancing one store's till against another's sales, and lets an alert email be identified without reading it all.",
  },
  "team.roles": {
    title: "Team roles",
    short: "Owner and superadmin see everything; supervisor several stores; store manager their store; seller only their own sales. The role decides which screens and which numbers each person sees.",
    what: "Every person in the panel has a role. Owner: there is only one; can do everything and is the only one who appoints superadmins. The owner or a superadmin can hand ownership to another superadmin (\"Make owner\", with their password) and the previous owner stays as a superadmin. Superadmin: same rights as the owner (prices, approvals, alerts, team). Supervisor: sees and approves in the stores assigned to them, with costs. Store manager: runs their store (till, sales, store team, approvals up to their limit). Seller: makes sales and sees only their own and their commission; no costs or profit.",
    how: [
      "When creating someone, pick the role and, except for owner/superadmin, the stores they have access to.",
      "A seller also needs their seller record (store, terminal and commission).",
      "To change a role, use the selector in their row; to remove access, deactivate all their assignments.",
      "Each person can have their own discount limit, above or below their role's.",
    ],
    why: "Granting more permissions than needed exposes costs and margins to people who should not see them and allows uncontrolled discounts. Granting fewer forces approval requests for everything.",
    pitfalls: ["Making a store manager a superadmin \"so they stop asking\": they will see every store and its costs."],
  },
  "posconfig.methods": {
    title: "Payment methods",
    short: "The ways the store accepts money (cash, card, Zelle, insurance…), with their fee, which stores use them and whether they ask for a reference.",
    what: "Each payment method has: name, kind, fee (percentage and/or fixed amount the bank or platform charges, booked as a cost of the sale), whether it counts as cash (goes into the till and the closing), whether it is \"receivable\" (like an insurer that pays later), which reference fields it asks for at checkout (last 4 digits, confirmation) and which stores it is active in.",
    how: [
      "To add one: type the name (and in English if you like), pick the kind, the fee and tick whether it counts as cash or is receivable.",
      "Add the reference fields the cashier must fill in and mark the required ones.",
      "Pick the stores where it is accepted and save.",
      "A method used in any sale is never deleted: it is deactivated so old sales keep balancing.",
    ],
    why: "The right fee is what makes the profit real (a 3% card on a $400 sale is $12). And \"counts as cash\" is what decides whether the till closing balances.",
    pitfalls: ["Marking the card as cash: the closing will always show a surplus."],
  },
  /* ─────────────── Sellers (Executive and seller panel) ─────────────── */
  "exec.sellers.quota": {
    title: "Seller quota",
    short: "What part of ALL the sales of the period (of the chosen store, or of every store) this seller made. 25% = one sale in four, in money, is theirs.",
    what: "Their sales as a percentage of everything sold in the same period under the same store filter: seller's sales ÷ total sales × 100. It is computed in money (not in number of sales) and the total includes sales with no seller assigned, so the quotas of every seller need not add up to 100%.",
    how: [
      "Pick the period and the store at the top: the quota is recomputed with that filter.",
      "Compare the quota with the commission: a seller with a high quota and a low commission is cheap for you; the other way round, review their percentage.",
      "In the sellers report the quota is the last column, biggest sales first.",
    ],
    why: "It says who the store depends on. If one person holds 70%, their day off shows in the till; spread quotas mean the team sells evenly.",
    example: "The store sold 10,000 in the month; Ana sold 2,500 → quota 25%. If 1,000 were web sales with no seller, the team's quotas add up to 90%.",
    pitfalls: ["Reading it as the commission percentage: the commission is what you pay them; the quota is what they sold compared with everyone else."],
  },
  "exec.sellers.avgProfit": {
    title: "Average profit per sale",
    short: "What each sale of this seller leaves you, on average, after materials, fixed costs, payment fees and their own commission.",
    what: "Gross profit of their sales in the period ÷ number of sales. The profit is the one of the Sales panel: net − frame and lens cost − fixed costs per order − payment fee (card) − seller's commission. Rent and the month's expenses are not in it.",
    how: [
      "Only whoever may see costs sees it (owner, superadmin or the \"view costs\" privilege).",
      "Compare it between sellers with a similar average ticket: one who sells high but discounts a lot can leave less per sale than one who sells less.",
    ],
    why: "Selling a lot is not earning: this figure says which seller turns each sale into money for the store.",
    pitfalls: ["Judging on a few sales: with two or three sales one frame without a defined cost moves the average a lot (watch the \"sales without cost\" notice)."],
  },
  "exec.sellers.commission": {
    title: "Commission to pay",
    short: "What you owe the seller for their sales of the period: their percentage applied to the net of each sale (before tax).",
    what: "The sum of the commission of each of their sales: net of the sale × their percentage. The percentage comes from their Team profile or, failing that, from their Sellers record. Changing the percentage recomputes the past too.",
    how: [
      "Pick the pay period (usually \"Last month\") and read the Commission column; the PDF/Excel report carries it per seller.",
      "A seller who is missing did not sell in the period: the Executive drops those who do not sell.",
    ],
    why: "It is a real cost of each sale: it is already subtracted from the profit. Paying it on another base (the total with tax, say) throws the margin off.",
    pitfalls: ["Paying on what the till collected: the commission is computed on what was sold in the period, not on what was collected."],
  },
  /* ─────────────── Cash till (store closing, Nov 2026) ─────────────── */
  "cash.close": {
    title: "Closing the store's register and approving differences",
    short: "The register belongs to the whole store. Closing counts the drawer (bill counter), signs with initials and, if it does not balance, the closing waits until the owner approves it with their signature.",
    what: "Since November 2026 there is ONE register per store, not one per till: the first cash payment of the day opens it on its own (with what was counted at the last closing) and every cash payment at any till goes into the same ledger. Each cash payment, each refund and each manual movement is one ledger line; Expected = opening float + cash in − cash out. On closing, the system compares the count with the expected amount. If it balances, the register is closed. If not, the closing is \"Awaiting approval\" and only the owner (or a superadmin) closes it by signing with their initials; the owner may do it in the same step when they are the one closing. Opening and closing print twice (store copy and closer's copy) and are emailed to the owner.",
    how: [
      "Click \"Close register\". Count the drawer with the counter (how many 100s, 50s, 20s… and coins) or type the total by hand.",
      "Watch the live difference: green when it balances, red when short, amber when over. Type your initials (2 to 4 letters) and, if there is a difference, a note with what happened.",
      "If you are the owner and there is a difference, also type your initials under \"Approve with my signature\" to close in one go. Otherwise the closing shows at the top under \"awaiting approval\" until the owner clicks \"Approve\".",
      "Print the closing (2 copies) and keep the store copy with the cash; the email to the owner goes out on its own (and can be re-sent).",
    ],
    why: "The owner asked that the closing always balance on hand-over and that only they approve a discrepancy, with a signature. The initials on the document and in the audit log say who counted and who approved, without signing on paper.",
    example: "Float 100 + cash payments 850 − refund 20 − supplier payment 200 = expected 730. Counted 725 → difference −5: awaits approval; the owner approves with \"DR\" and the register becomes closed.",
    pitfalls: [
      "Closing by typing the expected amount instead of counting: the register always balances and tells nothing.",
      "Letting pending closings pile up: each one is unexplained money; review them the same day.",
      "Recording a cash payment as card: it never enters the ledger and the closing is over or short for no reason.",
    ],
  },
  /* ─────────────── Prices and costs ("Prices and costs" panel, Nov 2026) ─────────────── */
  "price.rule": {
    title: "The price rule for every frame",
    short: "One instruction sets the SELLING price of every frame from its base price: \"+35 % over the base\". No need to touch frames one by one.",
    what: "A frame's base price is what the catalog already carries. The rule says what is done to that number to reach what the customer pays: a percentage on top (\"+35 %\") or a fixed amount per sale (\"+20\"). It applies to EVERY frame at once, and there is a twin rule for cases. With \"All stores\" selected above you are setting the master's rule, the one every store uses; pick a store and that store gets its own rule and the master's stops applying to it.",
    how: [
      "In the store selector above, pick \"All stores\" for the general rule, or a store to give it a different one.",
      "In \"Frames and cases\", on the \"Rule for every frame\" row, choose \"Percentage over the base\" or \"Fixed amount per sale\".",
      "Type the number (35 = +35 %; −10 = 10 % less) and press Save. What is in force reads next to it.",
      "\"No rule\" removes it: the base price is charged as it is.",
    ],
    why: "It is the difference between deciding the margin once and chasing five hundred prices by hand. Changing the rule changes the whole window display at once, and it is kept in the history with its date.",
    example: "A frame with base $20 and rule +35 % sells at $27. Change the rule to +50 % and the same frame becomes $30 without touching it.",
    pitfalls: [
      "Typing 1.35 instead of 35: the field is the percentage ADDED, not a multiplier.",
      "Thinking the rule touches the lenses: lenses have their own matrix and their own per-store percentage.",
      "Setting the rule with a store selected believing it is the general one: watch the pill at the top (\"Master\" or the store's name).",
    ],
  },
  "price.override": {
    title: "A frame's own price (going around the rule)",
    short: "You search the frame, type whatever price you want, and that one is out of the rule. The screen then shows only the rule and the ones you changed.",
    what: "An exception for one model. The price you type is that frame's (or case's) FINAL price: the general rule no longer applies to it. Prices are per model, not per colour: every colour of that frame costs the same. The \"Changed\" list is deliberately short: only what steps outside the rule.",
    how: [
      "Type two letters or more of the model in \"Search a frame or case…\" and pick it from the results.",
      "Type the price and press Save. It joins \"Changed\" with its base price beside it, to compare.",
      "To send it back to the rule, press \"Remove\" on its row. Nothing is deleted: it follows the rule again.",
      "With a store selected above, the price belongs to that store only; rows marked \"Inherited\" are the master's, which that store has not changed.",
    ],
    why: "Some frames do not take the rule: a very cheap one the margin makes ridiculous, an exclusive, one on clearance. This solves the case without breaking the system.",
    example: "The rule is +35 %, but you want the $60 aviator at a flat $99: search it, type 99, and it lands in \"Changed\".",
    pitfalls: [
      "Giving dozens of models their own price: if that happens, what is wrong is the rule, not the frames.",
      "Expecting an own price to rise when you raise the rule: it does not, it is a final price.",
      "Searching with one letter: two is the minimum so the whole catalog is not pulled in.",
    ],
  },
  "price.lensMatrix": {
    title: "The lens matrix: design × material",
    short: "The 2026 list as a table: a row per lens design, a column per material. The crossing is the lens price, added to the frame's.",
    what: "A pair of lenses is priced by two decisions: WHICH design (single vision, bifocal, progressive…) and IN WHICH material (CR-39, polycarbonate, 1.61, 1.67, 1.74). Each cell of the table is that price. Treatments (photochromic, anti-reflective) are separate and add up. What the counter charges is frame + cell + treatments.",
    how: [
      "Find the design's row and the material's column, click the number and type the new one.",
      "Leave the field (click away or Enter) and it saves. There is no button per cell on purpose: that is what lets you go down the table in one pass.",
      "With \"All stores\" you are changing the master, the price for the whole chain.",
      "With a store selected, what you type is THAT store's price; it stays highlighted and the field's tooltip says what the master charges.",
    ],
    why: "It is the list the counter quotes from. A wrong cell charges wrong all day and nobody notices until the month closes.",
    example: "Single vision in 1.67 costs $120. Raise 1.67 to $130 and every sale in that material from now on charges 10 more.",
    pitfalls: [
      "Changing the wrong material by reading the next column: watch the header, it stays put as you scroll.",
      "Typing cents without the point (13000 instead of 130.00).",
      "Believing a change to the master fixes a store with its own percentage: there the store's percentage decides.",
    ],
  },
  "price.photo": {
    title: "Photochromic and Transitions",
    short: "The lens that darkens in the sun. It is charged on top of the lens, and the price changes with the design: single vision, bifocal or progressive.",
    what: "A treatment added to the lens. The table has a row per option (Photochromic Grey, Transitions Gen S, XTRActive…) and a column per design category, because the same treatment costs differently on a progressive than on a single vision. \"Not offered\" means that combination does not exist and the system neither charges nor sells it.",
    how: [
      "Pick the option's row and the category's column (single vision, bifocal, progressive) and type the price.",
      "Leave the field and it saves, like the matrix.",
      "With a store selected, the price is that store's; with no own price it follows the store's general percentage.",
    ],
    why: "It is one of the best-selling add-ons and one of the most often mis-charged at the counter. Having it per category stops a photochromic progressive being charged as a single vision.",
    example: "Transitions Gen S Grey costs $105 in all three designs; Photochromic Brown is not offered in single vision, so that cell says \"Not offered\".",
    pitfalls: [
      "Putting a price in a \"Not offered\" cell \"just in case\": you start selling something the lab does not make.",
      "Mixing up generic photochromic with Transitions: different products, different prices.",
    ],
  },
  "price.ar": {
    title: "Anti-reflective (AR)",
    short: "The coating that removes reflections and night halos. There are two groups: the single-vision ones and the bifocal-and-progressive ones.",
    what: "Anti-reflective is a treatment with several grades (basic, plus, blue, Crystal, Flawless…). The system groups them by which lenses they can go on: \"single vision\" or \"bifocal and progressive\". Each has a price added to the lens and to the photochromic.",
    how: [
      "Type the price next to each coating and leave the field.",
      "With a store selected, the price is that store's; the pill says what the master charges.",
    ],
    why: "It is the highest-margin add-on of the sale. A wrong AR in the list under-charges hundreds of times before anyone checks.",
    example: "AR Green Basic $60 for single vision; Flawless $120 for progressives.",
    pitfalls: ["Pricing a progressive-group AR as a single-vision one: different coatings, and the lab charges differently."],
  },
  "price.progressive": {
    title: "The named progressives and their tier",
    short: "Purity Basic, DVG Distinct, DVG Camber… are progressive designs with names of their own. The gold pill says the tier and the line below who it is for.",
    what: "Besides \"progressive mid\" and \"premium\", the 2026 list has nine named digital progressives. Each carries its tier (Basic, Intermediate, Advanced, Premium, Upper premium, Elite) and a use note (\"frequent driving\", \"office and computer\"). The \"from\" price covers CR-39, polycarbonate, 1.56 and 1.61; 1.67 and 1.74 add a step depending on the tier.",
    how: [
      "Read the tier on the row's pill and the use under the name: that is what you tell the customer at the counter.",
      "Change each material's price in its column, as in the rest of the matrix.",
    ],
    why: "Recommending by tier and by use is what raises the ticket without pressure: the customer who drives at night understands why DVG Drive suits them.",
    example: "DVG Camber is Elite, \"top technology\": from $300, and $390 in 1.74.",
    pitfalls: ["Selling an office progressive for the street: the distance field is short and the customer brings it back."],
  },
  "price.storeVariation": {
    title: "ONE store's lens prices (% over the master)",
    short: "A single percentage raises or lowers every lens of that store over the general list. Give a cell an exact price and that price wins.",
    what: "Every store sells from the same master, but it can have its own price level (a store in a dearer area, a consignment one). Instead of loading a list per store, you set a percentage: +10 % charges 10 % more than the master on EVERY lens. And if one cell has to be an exact number, you type it in the matrix and that cell ignores the percentage.",
    how: [
      "Pick the store above, in the selector.",
      "In \"Lenses\", type the percentage in \"% over the master\" and save. Empty = the master, unchanged.",
      "For one cell, type it in the matrix: it stays highlighted and the pill counts how many cells have their own price.",
      "Per-store frame prices are set the same way, in \"Frames and cases\", with the store selected.",
    ],
    why: "It is what the owner asked for: \"each store manages its own prices separately, not by uploading files, but from that single master with variations\". The master stays one and nobody works off an old list.",
    example: "The master charges $100 for single vision 1.56. The store at +10 % charges $110. You then set that store's 1.74 at exactly $170: 1.74 is 170, the rest keeps the +10 %.",
    pitfalls: [
      "Typing the percentage with \"All stores\" selected: there is no percentage there, you edit the master.",
      "Forgetting that a cell with its own price does not rise when you raise the percentage.",
    ],
  },
  "price.commission": {
    title: "The seller's commission",
    short: "The percentage of each sale's net the seller takes. It is a real cost: it is already subtracted from the profit.",
    what: "Each seller has their percentage. It applies to the sale's NET (what was paid minus shipping, taxes and the payment fee), not to the total with tax. The \"default commission\" is what someone without their own starts with. Changing a percentage re-computes past sales too, because the cost sheet is computed with today's rules.",
    how: [
      "Type the default percentage and, below, each person's.",
      "Press \"Save commissions\": only what you changed is sent, and every change is in the audit log.",
    ],
    why: "It is money leaving every sale. Paying it on another base (the total with tax, say) throws the month's margin off.",
    example: "A sale with net $251 and a seller at 5 % → $12.55 of commission, already out of that sale's profit.",
    pitfalls: [
      "Paying on what the till collected: the commission is computed on what was sold in the period, not on what was collected.",
      "Raising a percentage and being surprised last month's margin drops: the past is re-computed.",
    ],
  },
  "price.costToggle": {
    title: "Switching a cost off in one store",
    short: "Each store can switch off the costs it does not pay (one pays no rent, another has no lab of its own). Without touching the general list.",
    what: "The cost rules are the owner's template: what a frame of a given brand costs, what the lab charges, the payment gateway's percentage. Not every store pays all of them. Each row's switch turns that cost off ONLY in the store selected above; the rest keep charging it and the general list does not change.",
    how: [
      "Pick the store above. With no store selected the switches are greyed out: a store is what decides.",
      "Clear the box of the cost that store does not pay. The row is struck through and reads \"Off in this store\".",
      "Tick it again to charge it once more. Every change is in the audit log with the before and after.",
    ],
    why: "Without this you either charge a store a rent it does not pay (and its result looks worse than it is), or you drop it for everyone (and the stores that do pay look more profitable).",
    example: "The mall store pays rent; the one in the owned unit does not. Switch \"Rent\" off in the second and its monthly result stops dragging an invented cost.",
    pitfalls: [
      "Switching a cost off \"so the month looks better\": the number stops being any use for deciding.",
      "Switching the payment fee off: the gateway charges it whether you switch it off or not.",
    ],
  },
  "price.tax": {
    title: "The tax on frames without a prescription",
    short: "Charged only when the purchase carries no prescription: prescription lenses are exempt. It is the same percentage the counter and the web store use.",
    what: "In this state prescription eyewear carries no sales tax, but a frame on its own (non-prescription sunglasses, a loose frame, a case) does. This percentage is what applies to those sales. It is saved once and read by the point of sale, the web cart and the cost sheet.",
    how: [
      "Type the percentage (7.25 for 7.25 %) and press Save.",
      "If the pill says \"Value from the environment\", it still comes from the server's configuration: saving here makes this number the one in force.",
    ],
    why: "Charging tax on a prescription lens over-charges the customer; not charging it on a loose frame means you pay it yourself when you file.",
    example: "Tax 8.25 %: $40 sunglasses are charged $43.30; the same $40 with a prescription are charged $40.",
    pitfalls: [
      "Typing 0.0825 instead of 8.25.",
      "Changing it without the accountant saying so: it is the number you file with.",
    ],
  },
};

/* ───────────── Cómo se calcula cada cifra (ventana de ayuda, 7-nov-2026) ─────────────
   Campos que la ventana pinta aparte: `formula` (bloque monoespaciado, una
   línea por paso), `usedIn` (dónde sale esa cifra, una por línea) y, donde
   faltaba, `example` con números. Cada fórmula está copiada del código que la
   calcula — no se inventa ninguna:
     Ejecutivo / Panel de ventas  backend lib/sales-insights.ts (net, cost, fee,
                                  commission, profit, margin_pct) y salesTotals()
                                  de StoreOrders.jsx (cobrado / por cobrar)
     Caja                          lib/cash.ts expectedCash() y lib/cash-report.ts
     Resultado / liquidación       lib/store-costs.ts computePnl(), lib/pos-statement.ts
     Precio del POS                lib/pos-data.ts (quote: discountLine + impuesto)
   Los temas `cost.*` y `backlog.*` tienen su texto en parts/costs.js y
   parts/backlog.js; aquí solo se les añaden `formula` y `usedIn`. */
const CALC_ES = {
  "exec.kpi.sales": {
    formula: "Ventas = Σ total de cada venta del período (sin las anuladas)\nTotal de una venta = precio de lista − descuento + impuesto",
    example: "Tres ventas de $250, $180 y $320 → Ventas = $750. Una cuarta de $200 que se anuló no suma.",
    usedIn: "Ejecutivo · KPI «Ventas»\nPanel de ventas\nEstado de tienda (hoy, semana, mes)\nInforme PDF / Excel del Ejecutivo",
  },
  "exec.kpi.collected": {
    formula: "Cobrado = Σ lo cobrado hasta hoy de cada venta del período (sin anuladas)\n  venta de tienda: anticipo + abonos posteriores (la parte del seguro no)\n  pedido web: su total (se paga al comprar)\nVentas = Cobrado + Por cobrar + parte del seguro",
    example: "Venta de $240 hoy con $100 de anticipo → suma $100 a Cobrado y $140 a Por cobrar. Si el cliente paga el resto la semana que viene, este mismo período pasa a $240 cobrados y $0 por cobrar.",
    usedIn: "Ejecutivo · KPI «Cobrado»\nPedidos y etapas (columna Cobrado)\nInforme PDF / Excel del Ejecutivo",
  },
  "exec.kpi.balance": {
    formula: "Por cobrar = Σ saldo pendiente HOY de cada venta del período (sin anuladas)\nSaldo de una venta = total − cobrado − parte del seguro",
    example: "En el mes hubo dos ventas con saldo: $140 y $60 → Por cobrar = $200. Una venta del mes pasado con $80 pendientes no entra aquí (sí en «Dinero en la calle»).",
    usedIn: "Ejecutivo · KPI «Por cobrar»\nPedidos y etapas (pastilla «saldo»)\nCobros pendientes (todas las fechas)",
  },
  "exec.kpi.cost": {
    formula: "Costo real = materiales + fijos por pedido + comisión del cobro\n  materiales = montura + lente según las reglas de Costos\n  fijos por pedido = reglas fijas, repartidas entre las líneas de la venta\n  comisión del cobro = la registrada con cada pago (tienda)\n                       · % + fijo de la pasarela (web)",
    example: "Montura $40 + lentes $35 + estuche (fijo por pedido) $3 + comisión de tarjeta $7.25 = costo real $85.25. La comisión del vendedor NO va aquí: se resta en la ganancia.",
    usedIn: "Ejecutivo · KPI «Costo real»\nPanel de ventas (columna Costo)\nCostos → Ganancia",
  },
  "exec.kpi.profit": {
    formula: "Ganancia bruta = Neto − costo real − comisión del vendedor\n  Neto = total − impuesto\n  costo real = materiales + fijos por pedido + comisión del cobro\n  comisión del vendedor = Neto × % del vendedor",
    example: "Venta de $250 sin impuesto: $250 − costo real $85.25 − comisión 5 % ($12.50) = ganancia bruta $152.25.",
    usedIn: "Ejecutivo · KPI «Ganancia bruta»\nPanel de ventas\nVendedores (ganancia y ganancia por venta)\nResultado de la tienda (contribución, antes de renta y fijos)",
  },
  "exec.kpi.margin": {
    formula: "Margen % = Ganancia bruta ÷ Neto × 100   (redondeado a 1 decimal)\nNeto = ventas − impuesto",
    example: "Ganancia bruta $152.25 ÷ Neto $250 × 100 = 60.9 %.",
    usedIn: "Ejecutivo · KPI «Margen»\nPanel de ventas (columna Margen)\nVendedores",
  },
  "exec.cash": {
    formula: "Efectivo en caja = cobros en efectivo − devoluciones en efectivo\n                 + entradas manuales − salidas manuales\n(por la fecha del cobro; el fondo inicial y las líneas automáticas\n del libro no se suman otra vez)",
    example: "Cobros en efectivo $1,200 − una devolución $40 + entrada $50 − pago a proveedor $200 = $1,010 de efectivo en el período.",
    usedIn: "Ejecutivo · KPI «Efectivo en caja» y acordeón «Cobros y caja»\nCaja → Informe de caja (efectivo neto)",
  },
  "exec.orders": {
    formula: "Pastilla «ventas» = Σ total de las ventas listadas (sin anuladas)\nPastilla «saldo» = Σ saldo pendiente hoy de esas ventas",
    usedIn: "Ejecutivo · acordeón «Pedidos y etapas»\nVentas de tienda",
  },
  "exec.ordersPlain": {
    formula: "Pastilla «ventas» = Σ total de las ventas listadas (sin anuladas)\nPastilla «saldo» = Σ saldo pendiente hoy de esas ventas",
    usedIn: "Ejecutivo · acordeón «Pedidos y etapas»\nVentas de tienda",
  },
  "exec.sellers.quota": {
    formula: "Cuota % = ventas del vendedor ÷ ventas totales del período × 100\n(mismo período y mismo filtro de tienda; en dinero, no en número de ventas)",
    usedIn: "Ejecutivo · acordeón «Vendedores» (columna Cuota)\nPanel del vendedor",
  },
  "exec.sellers.avgProfit": {
    formula: "Ganancia por venta = ganancia bruta de sus ventas ÷ número de ventas\nganancia bruta = Neto − costo real − comisión del vendedor",
    example: "Seis ventas que dejan en total $780 de ganancia bruta → $130 por venta.",
    usedIn: "Ejecutivo · acordeón «Vendedores»\nPanel del vendedor",
  },
  "exec.sellers.commission": {
    formula: "Comisión = Σ (Neto de cada venta × % del vendedor)\nNeto = total − impuesto",
    example: "Ventas del mes con Neto $8,000 y comisión del 5 % → $400 a pagar.",
    usedIn: "Ejecutivo · acordeón «Vendedores»\nPanel del vendedor y Mis ventas\nResultado de la tienda (comisiones)",
  },
  "cash.session": {
    formula: "Esperado = fondo inicial + Σ entradas − Σ salidas\n  entradas: cobros en efectivo + entradas manuales\n  salidas: devoluciones en efectivo + salidas manuales\nDiferencia = contado − esperado   (0 cuadra · − falta · + sobra)",
    usedIn: "Caja (tarjeta de la caja abierta)\nCierre de caja\nInforme de caja → Cierres",
  },
  "cash.close": {
    formula: "Debe haber = fondo inicial + Σ entradas − Σ salidas del libro\n(la línea «fondo inicial» del libro solo lo refleja: no se suma dos veces)\nDiferencia = contado − debe haber\n≠ 0 → «Pendiente de autorizar» hasta la firma del dueño",
    usedIn: "Caja → Cerrar caja (contador de billetes)\nCaja → Pendientes de autorizar\nInforme de caja → Cierres",
  },
  "cash.movement": {
    formula: "Entrada manual → suma al «debe haber» de la caja abierta\nSalida manual → resta del «debe haber»",
    example: "Caja con debe haber $730; pagas $45 de limpieza (salida, motivo «Gasto») → debe haber $685.",
    usedIn: "Caja → Movimiento\nInforme de caja (entradas y salidas por motivo)\nEjecutivo · «Efectivo en caja»",
  },
  "cash.report": {
    formula: "Cobrado por método = cobros − devoluciones (la parte del seguro va aparte, «por cobrar»)\nEfectivo neto = cobros en efectivo + entradas manuales − salidas manuales\nDiferencia de cierres = Σ (contado − esperado) de cada cierre",
    example: "Efectivo $1,200, tarjeta $2,300 (−$20 de devolución), Zelle $400 → cobrado $3,880. Entradas $50, salidas $200 → efectivo neto $1,050.",
    usedIn: "Caja → Informe de caja\nEjecutivo · «Cobros y caja»",
  },
  "statement.what": {
    formula: "Ventas = Σ total de las ventas del mes (las anuladas, aparte)\nLiquidación (tienda socia o en consignación) = (ventas − impuestos) × % acordado",
    example: "Ventas del mes $12,000 con $300 de impuestos, tienda en consignación al 40 % → base $11,700 × 40 % = $4,680 para la tienda.",
    usedIn: "Tiendas → Estado de cuenta (EST-<tienda>-<AAAAMM>)\nPDF para el socio · Excel para el contador",
  },
  "salesboard.what": {
    formula: "Neto = total − impuesto\nGanancia = Neto − costo − comisión del cobro − comisión del vendedor\nMargen % = Ganancia ÷ Neto × 100\nTicket medio = ventas ÷ número de ventas",
    example: "Un vendedor con 10 ventas por $3,000 ($2,900 de Neto) y $1,450 de ganancia → margen 50 %, ticket medio $300.",
    usedIn: "Panel de ventas (gráfica, tablas y lista)\nEjecutivo (los KPI salen de la misma lectura)",
  },
  "pos.step.price": {
    formula: "Precio de cada artículo = lista × (1 − descuento % ÷ 100)\nImpuesto = precio × tasa   (solo montura o estuche SIN lentes)\nTotal = Σ (precio con descuento + impuesto)\nDescuento $ = lista − (total − impuesto)",
    example: "Montura $120 + lentes $180 = lista $300; descuento 10 % → $270. Lleva receta: sin impuesto. Total $270, descuento $30.",
    usedIn: "Nueva venta · paso 5 y franja del total\nRecibo (lista, subtotal, descuento e impuesto una sola vez)",
  },
  "pos.step.payment": {
    formula: "Pagado = Σ importes de las líneas de pago (sin el seguro)\nSaldo = total − pagado − parte del seguro\nCambio (efectivo) = entregado − importe",
    example: "Total $270, anticipo en efectivo $100 → saldo $170. El cliente entrega $120 → cambio $20.",
    usedIn: "Nueva venta · paso 6\nRecibo\nCobros pendientes y «Por cobrar» del Ejecutivo",
  },
  "price.rule": {
    formula: "Precio de venta = base × (1 + % ÷ 100)     (regla «porcentaje»)\nPrecio de venta = base + monto               (regla «monto fijo»)\nSin regla → precio base",
    usedIn: "Productos y precios → Monturas y estuches\nNueva venta (precio de la montura)\nTienda web",
  },
  "price.override": {
    formula: "Montura con precio propio → precio de venta = el escrito (la regla no se aplica)",
    usedIn: "Productos y precios → Monturas y estuches («Modificados»)\nNueva venta",
  },
  "price.storeVariation": {
    formula: "Lente en la tienda = precio del maestro × (1 + % de la tienda ÷ 100)\nCasilla con precio exacto → ese precio (el % no se aplica)",
    usedIn: "Productos y precios → Lentes (tienda elegida)\nNueva venta (precio de los lentes)",
  },
  "price.commission": {
    what: "Cada vendedor tiene su porcentaje y se aplica al NETO, nunca al total con impuestos. En las ventas de tienda el neto es el total menos el impuesto; en los pedidos web (fichas de costo) es lo pagado menos envío, impuestos y la comisión de Stripe. La «comisión por defecto» es con la que arranca quien no tenga una propia. Cambiar un porcentaje recalcula también las ventas pasadas, porque las cifras se calculan con las reglas de hoy.",
    formula: "Venta de tienda: comisión = (total − impuesto) × % del vendedor\nPedido web:      comisión = (pagado − envío − impuestos − Stripe) × %",
    usedIn: "Reglas y comisiones → Comisiones\nEjecutivo · Vendedores\nPanel del vendedor\nResultado de la tienda",
  },
  "price.tax": {
    formula: "Impuesto = precio con descuento × tasa   (solo montura o estuche sin lentes)\nCon receta → 0",
    usedIn: "Nueva venta (precio)\nCarrito de la tienda web\nFichas de costo",
  },
  "cost.paid": { formula: "Pagado = Σ total pagado de cada pedido (producto + envío + impuestos)", usedIn: "Ejecutivo → Costos operacionales\nCostos → Ganancia" },
  "cost.net": { formula: "Neto = Pagado − envío − impuestos − Stripe\nStripe = Pagado × % + fijo («Comisiones de pago»)", usedIn: "Costos operacionales\nCostos → Distribución % (base de cada partida)" },
  "cost.cost": { formula: "Costo = materiales + Σ (partida % × Neto) + comisión del vendedor + ajustes manuales", usedIn: "Costos operacionales\nCostos → Fichas de costo" },
  "cost.profit": { formula: "Ganancia = Neto − Costo\nGanancia % = Ganancia ÷ Neto × 100", usedIn: "Costos operacionales\nCostos → Ganancia" },
  "cost.target": { formula: "Objetivo $ = Neto × objetivo %\nDiferencia = Ganancia − Objetivo $", usedIn: "Costos operacionales (tarjeta Objetivo y marca ◆)\nCostos → Distribución %" },
  "cost.incomplete": { formula: "Incompletas = n.º de pedidos con alguna pieza sin regla de costo (entra a $0)", usedIn: "Costos operacionales\nCostos → Fichas de costo" },
  "cost.split": { formula: "Pagado = deducciones + materiales + partidas % + vendedor + ajustes + ganancia\nCada bloque % = bloque ÷ Pagado × 100", usedIn: "Costos operacionales (barra «Reparto del ingreso»)" },
  "cost.deductions": { formula: "Deducciones = envío + impuestos + Stripe", usedIn: "Costos operacionales\nCostos → Comisiones de pago" },
  "cost.materials": { formula: "Materiales = montura + lentes + tratamientos + estuche (+ fijos por pedido)", usedIn: "Costos operacionales\nCostos → Fichas de costo" },
  "cost.percent": { formula: "Partida = Neto × %\nPartidas % = Σ partidas", usedIn: "Costos operacionales\nCostos → Distribución %" },
  "cost.commission": { formula: "Comisión = Neto × % del vendedor", usedIn: "Costos operacionales (tarjeta Vendedores)\nVendedores" },
  "cost.marginChart": { formula: "Ganancia del día = ventas − costo\nMargen del día % = ganancia ÷ ventas × 100", usedIn: "Costos operacionales (gráfica «Ventas vs costo por día»)" },
  "backlog.street": { formula: "Dinero en la calle = Σ saldo pendiente de TODAS las ventas no anuladas\n(de cualquier fecha: no depende del período)", usedIn: "Ejecutivo · «Ahora mismo»\nCobros pendientes\nInicio" },
  "backlog.overdue": { formula: "Atrasados = Σ saldo de las ventas cuya fecha prometida ya pasó", usedIn: "Ejecutivo · «Ahora mismo»\nCobros pendientes (filtro «solo atrasados»)" },
};

const CALC_EN = {
  "exec.kpi.sales": {
    formula: "Sales = Σ total of each sale in the period (voided ones excluded)\nTotal of a sale = list price − discount + tax",
    example: "Three sales of $250, $180 and $320 → Sales = $750. A fourth one of $200 that was voided does not count.",
    usedIn: "Executive · \"Sales\" KPI\nSales board\nStore status (today, week, month)\nExecutive PDF / Excel report",
  },
  "exec.kpi.collected": {
    formula: "Collected = Σ collected to date on each sale of the period (voided excluded)\n  store sale: deposit + later payments (the insurer's part is not)\n  web order: its total (paid at checkout)\nSales = Collected + Balance due + insurer's part",
    example: "A $240 sale today with a $100 deposit → adds $100 to Collected and $140 to Balance due. If the customer pays the rest next week, this same period becomes $240 collected and $0 due.",
    usedIn: "Executive · \"Collected\" KPI\nOrders and stages (Collected column)\nExecutive PDF / Excel report",
  },
  "exec.kpi.balance": {
    formula: "Balance due = Σ balance still owed TODAY on each sale of the period (voided excluded)\nBalance of a sale = total − collected − insurer's part",
    example: "Two sales of the month still owe $140 and $60 → Balance due = $200. A sale from last month owing $80 is not here (it is in \"Money on the street\").",
    usedIn: "Executive · \"Balance due\" KPI\nOrders and stages (\"balance\" pill)\nPending balances (all dates)",
  },
  "exec.kpi.cost": {
    formula: "Real cost = materials + fixed per order + payment fee\n  materials = frame + lens from the Costs rules\n  fixed per order = fixed rules, split across the sale's lines\n  payment fee = the one recorded with each payment (store)\n                · gateway % + fixed (web)",
    example: "Frame $40 + lenses $35 + case (fixed per order) $3 + card fee $7.25 = real cost $85.25. The seller's commission is NOT here: it is subtracted in the profit.",
    usedIn: "Executive · \"Real cost\" KPI\nSales board (Cost column)\nCosts → Profit",
  },
  "exec.kpi.profit": {
    formula: "Gross profit = Net − real cost − seller commission\n  Net = total − tax\n  real cost = materials + fixed per order + payment fee\n  seller commission = Net × seller %",
    example: "A $250 sale with no tax: $250 − real cost $85.25 − 5% commission ($12.50) = gross profit $152.25.",
    usedIn: "Executive · \"Gross profit\" KPI\nSales board\nSellers (profit and profit per sale)\nStore result (contribution, before rent and fixed costs)",
  },
  "exec.kpi.margin": {
    formula: "Margin % = Gross profit ÷ Net × 100   (rounded to 1 decimal)\nNet = sales − tax",
    example: "Gross profit $152.25 ÷ Net $250 × 100 = 60.9%.",
    usedIn: "Executive · \"Margin\" KPI\nSales board (Margin column)\nSellers",
  },
  "exec.cash": {
    formula: "Cash on hand = cash payments − cash refunds\n             + manual cash in − manual cash out\n(by payment date; the opening float and the ledger's automatic\n lines are not added again)",
    example: "Cash payments $1,200 − one refund $40 + cash in $50 − supplier payment $200 = $1,010 of cash in the period.",
    usedIn: "Executive · \"Cash on hand\" KPI and \"Collections and cash\" accordion\nTill → Cash report (net cash)",
  },
  "exec.orders": {
    formula: "\"sales\" pill = Σ total of the listed sales (voided excluded)\n\"balance\" pill = Σ balance still owed today on those sales",
    usedIn: "Executive · \"Orders and stages\" accordion\nStore sales",
  },
  "exec.ordersPlain": {
    formula: "\"sales\" pill = Σ total of the listed sales (voided excluded)\n\"balance\" pill = Σ balance still owed today on those sales",
    usedIn: "Executive · \"Orders and stages\" accordion\nStore sales",
  },
  "exec.sellers.quota": {
    formula: "Share % = seller's sales ÷ total sales of the period × 100\n(same period and store filter; in money, not number of sales)",
    usedIn: "Executive · \"Sellers\" accordion (Share column)\nSeller panel",
  },
  "exec.sellers.avgProfit": {
    formula: "Profit per sale = gross profit of their sales ÷ number of sales\ngross profit = Net − real cost − seller commission",
    example: "Six sales leaving $780 of gross profit in total → $130 per sale.",
    usedIn: "Executive · \"Sellers\" accordion\nSeller panel",
  },
  "exec.sellers.commission": {
    formula: "Commission = Σ (Net of each sale × seller %)\nNet = total − tax",
    example: "Sales of the month with $8,000 Net and a 5% commission → $400 to pay.",
    usedIn: "Executive · \"Sellers\" accordion\nSeller panel and My sales\nStore result (commissions)",
  },
  "cash.session": {
    formula: "Expected = opening float + Σ in − Σ out\n  in: cash payments + manual cash in\n  out: cash refunds + manual cash out\nDifference = counted − expected   (0 balanced · − short · + over)",
    usedIn: "Till (open register card)\nClosing the till\nCash report → Closings",
  },
  "cash.close": {
    formula: "Should have = opening float + Σ in − Σ out of the ledger\n(the ledger's \"opening float\" line only mirrors it: never added twice)\nDifference = counted − should have\n≠ 0 → \"Pending approval\" until the owner signs",
    usedIn: "Till → Close till (bill counter)\nTill → Pending approval\nCash report → Closings",
  },
  "cash.movement": {
    formula: "Manual cash in → adds to the open register's \"should have\"\nManual cash out → subtracts from it",
    example: "Register should have $730; you pay $45 for cleaning (cash out, reason \"Expense\") → should have $685.",
    usedIn: "Till → Movement\nCash report (in and out by reason)\nExecutive · \"Cash on hand\"",
  },
  "cash.report": {
    formula: "Collected per method = payments − refunds (the insurer's part is separate, \"receivable\")\nNet cash = cash payments + manual cash in − manual cash out\nClosing difference = Σ (counted − expected) of each closing",
    example: "Cash $1,200, card $2,300 (−$20 refund), Zelle $400 → collected $3,880. Cash in $50, cash out $200 → net cash $1,050.",
    usedIn: "Till → Cash report\nExecutive · \"Collections and cash\"",
  },
  "statement.what": {
    formula: "Sales = Σ total of the month's sales (voided ones listed apart)\nSettlement (partner or consignment store) = (sales − taxes) × agreed %",
    example: "Month sales $12,000 with $300 of taxes, consignment store at 40% → base $11,700 × 40% = $4,680 for the store.",
    usedIn: "Stores → Statement (EST-<store>-<YYYYMM>)\nPDF for the partner · Excel for the accountant",
  },
  "salesboard.what": {
    formula: "Net = total − tax\nProfit = Net − cost − payment fee − seller commission\nMargin % = Profit ÷ Net × 100\nAverage ticket = sales ÷ number of sales",
    example: "A seller with 10 sales for $3,000 ($2,900 Net) and $1,450 of profit → 50% margin, $300 average ticket.",
    usedIn: "Sales board (chart, tables and list)\nExecutive (its KPIs come from the same read)",
  },
  "pos.step.price": {
    formula: "Price of each item = list × (1 − discount % ÷ 100)\nTax = price × rate   (only a frame or case WITHOUT lenses)\nTotal = Σ (discounted price + tax)\nDiscount $ = list − (total − tax)",
    example: "Frame $120 + lenses $180 = list $300; 10% discount → $270. With a prescription: no tax. Total $270, discount $30.",
    usedIn: "New sale · step 5 and the running-total strip\nReceipt (list, subtotal, discount and tax once)",
  },
  "pos.step.payment": {
    formula: "Paid = Σ amounts of the payment lines (insurance excluded)\nBalance = total − paid − insurer's part\nChange (cash) = tendered − amount",
    example: "Total $270, $100 cash deposit → balance $170. The customer hands over $120 → change $20.",
    usedIn: "New sale · step 6\nReceipt\nPending balances and the Executive's \"Balance due\"",
  },
  "price.rule": {
    formula: "Selling price = base × (1 + % ÷ 100)     (\"percentage\" rule)\nSelling price = base + amount              (\"fixed amount\" rule)\nNo rule → base price",
    usedIn: "Products and prices → Frames and cases\nNew sale (frame price)\nOnline store",
  },
  "price.override": {
    formula: "Frame with its own price → selling price = the one typed (the rule does not apply)",
    usedIn: "Products and prices → Frames and cases (\"Modified\")\nNew sale",
  },
  "price.storeVariation": {
    formula: "Lens in the store = master price × (1 + store % ÷ 100)\nCell with an exact price → that price (the % does not apply)",
    usedIn: "Products and prices → Lenses (chosen store)\nNew sale (lens price)",
  },
  "price.commission": {
    what: "Each seller has their percentage and it always applies to the NET, never to the total with tax. On store sales the net is the total minus tax; on web orders (cost sheets) it is what was paid minus shipping, taxes and the Stripe fee. The \"default commission\" is what someone without their own starts with. Changing a percentage re-computes past sales too, because the figures are computed with today's rules.",
    formula: "Store sale: commission = (total − tax) × seller %\nWeb order:  commission = (paid − shipping − taxes − Stripe) × %",
    usedIn: "Rules and commissions → Commissions\nExecutive · Sellers\nSeller panel\nStore result",
  },
  "price.tax": {
    formula: "Tax = discounted price × rate   (only a frame or case without lenses)\nWith a prescription → 0",
    usedIn: "New sale (price)\nOnline store cart\nCost sheets",
  },
  "cost.paid": { formula: "Paid = Σ total paid on each order (product + shipping + taxes)", usedIn: "Executive → Operating costs\nCosts → Profit" },
  "cost.net": { formula: "Net = Paid − shipping − taxes − Stripe\nStripe = Paid × % + fixed (\"Payment fees\")", usedIn: "Operating costs\nCosts → % allocation (base of each item)" },
  "cost.cost": { formula: "Cost = materials + Σ (% item × Net) + seller commission + manual adjustments", usedIn: "Operating costs\nCosts → Cost sheets" },
  "cost.profit": { formula: "Profit = Net − Cost\nProfit % = Profit ÷ Net × 100", usedIn: "Operating costs\nCosts → Profit" },
  "cost.target": { formula: "Target $ = Net × target %\nDifference = Profit − Target $", usedIn: "Operating costs (Target card and ◆ mark)\nCosts → % allocation" },
  "cost.incomplete": { formula: "Incomplete = number of orders with some item lacking a cost rule (counted at $0)", usedIn: "Operating costs\nCosts → Cost sheets" },
  "cost.split": { formula: "Paid = deductions + materials + % items + seller + adjustments + profit\nEach block % = block ÷ Paid × 100", usedIn: "Operating costs (\"Revenue split\" bar)" },
  "cost.deductions": { formula: "Deductions = shipping + taxes + Stripe", usedIn: "Operating costs\nCosts → Payment fees" },
  "cost.materials": { formula: "Materials = frame + lenses + treatments + case (+ fixed per order)", usedIn: "Operating costs\nCosts → Cost sheets" },
  "cost.percent": { formula: "Item = Net × %\n% items = Σ items", usedIn: "Operating costs\nCosts → % allocation" },
  "cost.commission": { formula: "Commission = Net × seller %", usedIn: "Operating costs (Sellers card)\nSellers" },
  "cost.marginChart": { formula: "Day profit = sales − cost\nDay margin % = profit ÷ sales × 100", usedIn: "Operating costs (\"Sales vs cost per day\" chart)" },
  "backlog.street": { formula: "Money on the street = Σ balance owed on ALL non-voided sales\n(any date: it does not depend on the period)", usedIn: "Executive · \"Right now\"\nPending balances\nHome" },
  "backlog.overdue": { formula: "Overdue = Σ balance of the sales whose promised date has passed", usedIn: "Executive · \"Right now\"\nPending balances (\"only overdue\" filter)" },
};

/* Temas nuevos de pantallas que no tenían ayuda (Cobros pendientes, Estado de tienda). */
const NEW_ES = {
  "pending.what": {
    title: "Cobros pendientes",
    short: "Todas las ventas con saldo por cobrar, de cualquier fecha, ordenadas por los días de atraso. Desde cada una se cobra el resto.",
    what: "Lista las ventas no anuladas de la(s) tienda(s) elegida(s) que todavía deben dinero, sin importar el período: un saldo de hace tres meses sigue aquí hasta que se cobra. Los días de atraso se cuentan desde la fecha prometida al cliente (la del recibo) o, si la venta no tiene, desde que se hizo.",
    formula: "Saldo de una venta = total − cobrado − parte del seguro\nTotal pendiente = Σ saldos de la lista\nDías de atraso = hoy − fecha prometida (o fecha de la venta), nunca negativo\nAtrasadas = ventas con más de 7 días de atraso",
    example: "Venta de $240 prometida para el día 3, con $100 de anticipo. El día 12 sale con $140 de saldo y 9 días de atraso: cuenta como atrasada.",
    usedIn: "Cobros pendientes\nEjecutivo · «Dinero en la calle» y «Atrasados»\nMis ventas (pendientes de la tienda)",
    how: [
      "Ordena por días de atraso (ya viene así) y empieza por arriba.",
      "Abre la venta y pulsa «Cobrar saldo» cuando el cliente pague.",
      "Usa «solo atrasados» para la lista de llamadas del día.",
    ],
    why: "Cada saldo es dinero que la tienda ya pagó al laboratorio. Cuanto más viejo, más difícil de cobrar.",
  },
  "storestatus.what": {
    title: "Estado de la tienda",
    short: "La tienda AHORA: ventas de hoy, de la semana y del mes, la caja abierta, quién vende y lo que queda pendiente (aprobaciones, anulaciones, listos para entregar, saldos y seguros).",
    what: "Una sola pantalla para el encargado: cuánto lleva vendido la tienda hoy (con la comparación frente a ayer), en la semana (desde el lunes) y en el mes, el ticket medio, el estado de la caja de la tienda y la lista de cosas por resolver. No usa el período de la barra: siempre es «ahora», con las fechas de la zona horaria de la tienda.",
    formula: "Ventas de hoy / semana / mes = Σ total de las ventas (sin anuladas)\n  semana = desde el lunes · mes = desde el día 1\nTicket medio = ventas ÷ número de ventas\nvs. ayer % = (hoy − ayer) ÷ ayer × 100\nCon saldo = n.º de ventas con saldo > 0 · importe = Σ saldos",
    example: "Hoy $620 en 3 ventas (ticket medio $206.67); ayer $500 → +24 % vs. ayer.",
    usedIn: "Estado de tienda\nInforme PDF / Excel de la barra",
    how: [
      "Toca un indicador para ir a la pantalla que lo explica (ventas, aprobaciones, ventas de tienda).",
      "Resuelve los pendientes en rojo antes de cerrar el día.",
    ],
    why: "Es lo primero que mira el encargado al abrir y lo último al cerrar: si algo queda en rojo, mañana empieza con un problema.",
  },
};
const NEW_EN = {
  "pending.what": {
    title: "Pending balances",
    short: "Every sale with a balance still owed, from any date, sorted by days overdue. You collect the rest from each one.",
    what: "Lists the non-voided sales of the chosen store(s) that still owe money, whatever the period: a balance from three months ago stays here until it is collected. Days overdue count from the date promised to the customer (the one on the receipt) or, if the sale has none, from when it was made.",
    formula: "Balance of a sale = total − collected − insurer's part\nTotal pending = Σ balances in the list\nDays overdue = today − promised date (or sale date), never negative\nOverdue = sales more than 7 days overdue",
    example: "A $240 sale promised for the 3rd, with a $100 deposit. On the 12th it shows $140 owed and 9 days overdue: it counts as overdue.",
    usedIn: "Pending balances\nExecutive · \"Money on the street\" and \"Overdue\"\nMy sales (store pending)",
    how: [
      "Sort by days overdue (the default) and start at the top.",
      "Open the sale and press \"Collect balance\" when the customer pays.",
      "Use \"only overdue\" for the day's call list.",
    ],
    why: "Each balance is money the store already paid the lab. The older it gets, the harder it is to collect.",
  },
  "storestatus.what": {
    title: "Store status",
    short: "The store RIGHT NOW: sales today, this week and this month, the open till, who is selling and what is pending (approvals, voids, ready to hand over, balances and insurance).",
    what: "One screen for the manager: how much the store has sold today (compared with yesterday), this week (since Monday) and this month, the average ticket, the state of the store's till and the list of things to resolve. It does not use the bar's period: it is always \"now\", with the dates of the store's time zone.",
    formula: "Sales today / week / month = Σ total of the sales (voided excluded)\n  week = since Monday · month = since the 1st\nAverage ticket = sales ÷ number of sales\nvs. yesterday % = (today − yesterday) ÷ yesterday × 100\nWith balance = number of sales owing > 0 · amount = Σ balances",
    example: "Today $620 in 3 sales (average ticket $206.67); yesterday $500 → +24% vs. yesterday.",
    usedIn: "Store status\nBar PDF / Excel report",
    how: [
      "Tap an indicator to go to the screen that explains it (sales, approvals, store sales).",
      "Resolve the red items before closing the day.",
    ],
    why: "It is the first thing the manager checks when opening and the last when closing: anything left red starts tomorrow with a problem.",
  },
};

/** Mezcla campo a campo: lo de `extra` se añade (o corrige) sobre el tema existente. */
function withCalc(topics, extra) {
  const out = { ...topics };
  for (const [k, fields] of Object.entries(extra)) out[k] = { ...(out[k] || {}), ...fields };
  return out;
}

/** Aplana {tema: {campo: texto | [líneas]}} a claves `adm.help.<tema>.<campo>`. */
function flatten(topics) {
  const out = {};
  for (const [topic, fields] of Object.entries(topics)) {
    for (const [field, value] of Object.entries(fields)) {
      out[`adm.help.${topic}.${field}`] = Array.isArray(value) ? value.join("\n") : value;
    }
  }
  return out;
}

export default {
  es: { ...UI.es, ...flatten(withCalc({ ...TOPICS_ES, ...NEW_ES }, CALC_ES)) },
  en: { ...UI.en, ...flatten(withCalc({ ...TOPICS_EN, ...NEW_EN }, CALC_EN)) },
};
