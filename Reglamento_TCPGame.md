# TCPGame: reglamento v0.3 (control de flujo y control de congestión, sin segmento de sondeo)

> Borrador del 2026-11-15. Usa el mismo modelo de tiempo y las mismas reglas que el simulador de ejercicios de secuencias TCP de la asignatura. Las cartas N (control de flujo) usan los números de los ejercicios de clase: A envía 6 × 64 B a B, que tiene un búfer de 256 B, y sus partidas de referencia del §9 coinciden tic a tic con las soluciones de esos ejercicios. Las cartas C (control de congestión, GG3.4 y GG3.5) añaden la ventana de congestión de A (§6, A5–A13) y sus partidas de referencia salen del simulador de ejercicios. Variables con los nombres de Kurose (edición en español; control de congestión en §3.7). Los tics se cuentan desde 1, como en los ejercicios.

## 1. Para qué sirve

En el diagrama de secuencia el alumno lo ve todo a la vez. En el juego, cada jugador solo sabe **lo que le ha llegado y lo que tiene apuntado en su hoja**, que es todo lo que sabe TCP en cada extremo. Al final se juntan las tarjetas y se dibuja el diagrama completo, para comparar lo que creía cada uno con lo que pasó en realidad.

## 2. Jugadores y material

Se juega en **tríos**, con tres partidas para que cada alumno haga los tres papeles:

| Papel | Qué es | Qué ve |
|---|---|---|
| **Cliente A** | TCP del emisor. Su aplicación le ha dado un fichero para enviar | Su hoja de estado y los segmentos que le llegan |
| **Servidor B** | TCP del receptor | Su hoja de estado, los segmentos que le llegan y los avisos de lectura de su aplicación |
| **Árbitro** | La red y la aplicación de B | Todo: la carta de escenario, las tarjetas y el registro |

Material de cada trío:

- **Un separador** entre A y B (una carpeta de pie), o los dos sentados de espaldas.
- **Tarjetas de segmento** (§5), unas 20 por jugador.
- **Hoja de estado de A** y **hoja de estado de B** (§10).
- **Carta de escenario**, que solo ve el árbitro (§9).
- **Registro del árbitro**: una plantilla de dos líneas de vida en blanco, como la plantilla de diagramas de secuencia TCP que se usa en los ejercicios.

## 3. Datos de partida (los conocen los dos)

- La conexión ya está abierta: no se dibuja la apertura.
- MSS = 64 B. Todos los segmentos de datos llevan 64 B.
- A empieza a enviar en el **SN = 1024**. Los ACK de B llevan **SN = 2048**.
- En la apertura, B anunció **W = 256** (su `BufferRecepcion` está vacío).
- B no envía datos. A pone siempre AN = 2048 y W = 512 en sus segmentos, que vienen ya impresos en su tarjeta.

### Datos de partida de las cartas C

Las cartas C (§9) cambian el fichero y el búfer, y dan a A su estado de congestión. Todo lo demás es igual.

- **Fichero.** Entre 8 y 10 segmentos de 64 B, según la carta. Empieza en el SN = 1024 y el ACK final lleva AN = 1024 + 64 × (número de segmentos).
- **Búfer de B.** 1024 B, para que la W no limite a A. La excepción es C4, con 256 B. La W inicial es el tamaño del búfer.
- **Estado de A.** Conoce su `VentCongestion` (VC, en MSS), su `umbralAL` (Umbral) y su modo (AL, EC o RR) de partida. Los escribe en la primera fila de su hoja (§10).
- **Temporizador.** La carta da su valor en tics, y A lo conoce (§6, A12).

### Lo que sabe y lo que no sabe cada uno

| | Sabe | No sabe |
|---|---|---|
| **A** | El tamaño del fichero (384 B, del 1024 al 1407), lo que ha enviado y los ACK que le han llegado. En las cartas C, además, su VC, su umbral y su modo | Cuánto tiene B en el búfer, cuándo lee su aplicación, si algo se ha perdido o va de camino. Si un ACK no llega, no sabe si es pérdida o retraso. Tampoco sabe cuánto aguanta la red |
| **B** | Lo que le ha llegado, lo que ha leído su aplicación y lo que ha anunciado | Cuánto ocupa el fichero, cuántos segmentos le quedan por llegar, cuándo leerá su aplicación |

## 4. Cómo se juega un tic

Cada tic tiene cuatro pasos. El árbitro dice en voz alta «Tic *n*».

1. **Eventos.** El árbitro entrega a cada jugador, boca abajo, las tarjetas que le llegaron en el tic anterior. A B le dice también, si toca, «tu aplicación ha leído los octetos *x*–*y*» (§7). A A le dice, en las cartas C y si toca, «vence tu temporizador» (§6, A12).
2. **Estado.** Cada jugador apunta los eventos en su hoja y actualiza sus variables.
3. **Decisión.** Cada jugador rellena en secreto **una tarjeta**: un segmento o «no envío». Las dos se entregan siempre, aunque estén en blanco, para que nadie sepa si el otro ha enviado algo por cómo se mueve.
4. **Red.** El árbitro escribe el tic en las dos tarjetas, las copia en el registro y las guarda para entregarlas en el paso 1 del tic siguiente. Si la carta de escenario dice que una se pierde, se queda con ella y no dice nada.

Este turno equivale al modelo de los ejercicios y del examen: el segmento sale al comienzo del tic *n*, llega a mitad del tic *n* y el receptor responde, como pronto, en el tic *n* + 1.

**Un segmento por tic y jugador**, como en los ejercicios. Si quieres enviar dos, van en tics consecutivos.

## 5. La tarjeta de segmento

```
┌────────────────────────────────────┐
│ Tic: ___ (lo escribe el árbitro)   │
│ De:  A / B                         │
│ SN:  ______   AN: ______   ACK [x] │
│ W:   ______                        │
│ Datos: ___ B (octetos ____–____)   │
│ [ ] No envío nada en este tic      │
└────────────────────────────────────┘
```

## 6. Reglas del cliente A (emisor)

- **A1. Ventana.** A puede enviar un segmento de 64 B si
  `(UltimoByteEnviado − UltimoByteReconocido) + 64 ≤ VentRecepcion`,
  donde `VentRecepcion` es la W del **último ACK recibido** (al principio, 256). Kurose: `UltimoByteEnviado − UltimoByteReconocido ≤ VentRecepcion`.
- **A2. Al recibir un ACK**: `UltimoByteReconocido = AN − 1` y `VentRecepcion = W`.
- **A3. Ventana cerrada.** Si no cabe ningún segmento, A **espera**. En esta versión no hay segmento de sondeo.
- **A4. Fin.** Cuando A recibe un ACK con **AN = 1408** (en las cartas C, el AN que cierra su fichero), levanta la mano: **cree** que el fichero ha llegado entero. Si es verdad o no lo comprueba el árbitro en la puesta en común (§11).

Valores iniciales: `UltimoByteEnviado = UltimoByteReconocido = 1023` y `VentRecepcion = 256`.

### Reglas de congestión de A (cartas C)

Las cartas N no las usan. En las cartas C, A guarda tres variables más: `VentCongestion` (VC, en MSS, puede ser fraccionaria), `umbralAL` (Umbral, en MSS) y el modo: **AL** (arranque lento), **EC** (evitación de la congestión) o **RR** (recuperación rápida). Son los nombres de la tabla de equivalencias de las diapositivas de GG3.4 y GG3.5.

A5 a A7 y A12 se ven en GG3.4 (VC, AL y sus tres salidas). A8 a A11 y A13 son de GG3.5 (EC, RR, Reno y Tahoe).

- **A5. Ventana de congestión y envío** (GG3.4). Los **segmentos en vuelo** son `(UltimoByteEnviado − UltimoByteReconocido) / 64`, también los que se han perdido, porque A no lo sabe. A puede enviar un segmento **nuevo** si
  `en vuelo < ⌊VC⌋` y además cabe en la W (A1). Es decir, A no supera mín{VC, W}. En las diapositivas, lo mismo es `Cvc = VC − segmentos pendientes ≥ 1`.
  Ejemplo: con VC = 4 + 2/4 y 4 segmentos en vuelo, no envía (4 < 4 es falso). Con 3, sí.
- **A6. Arranque lento** (GG3.4). Por cada segmento reconocido, `VC = VC + 1`. Un ACK acumulativo que reconoce *k* segmentos suma *k*.
  Ejemplo: VC = 2 y llega un ACK de 2 segmentos: VC = 4.
- **A7. De AL a EC** (GG3.4). Cuando la VC alcanza el Umbral, el modo pasa a EC. Si un ACK lo cruza, se suma en AL hasta el Umbral y el resto de segmentos de ese ACK cuenta como EC (A8).
  Ejemplo: VC = 3, Umbral = 4 y un ACK de 2 segmentos: 3 → 4, y el segundo cuenta en EC: VC = 4 + 1/4.
- **A8. Evitación de la congestión** (GG3.5). Se escribe `VC = N + c/N`. Cada segmento reconocido suma 1/N, o sea `c = c + 1`. Al llegar a N/N, la parte entera sube uno y `c` vuelve a 0.
  Ejemplo: VC = 4 + 3/4 y un ACK de 2 segmentos: 4 + 4/4 = 5, y después 5 + 1/5.
- **A9. Tercer ACK duplicado, Reno** (GG3.5). Un **ACK duplicado** es un ACK con el mismo AN que el anterior, cuando hay datos sin reconocer y sin que agrande la W (si la agranda, es una actualización de ventana). A cuenta los duplicados en `contadorACKdup`; el primero y el segundo no cambian nada. Un ACK que avanza o el vencimiento del temporizador ponen la cuenta a 0. Al **tercero**, en AL o en EC: `Umbral = VC/2`, `VC = Umbral + 3`, retransmite el segmento más antiguo sin reconocer y pasa a RR. No espera al temporizador: la retransmisión rápida está siempre activa en las cartas C.
  Ejemplo: VC = 8 → Umbral = 4, VC = 7, RR.
- **A10. En RR** (GG3.5). Cada duplicado más suma 1: `VC = VC + 1`. En RR A puede enviar segmentos nuevos si A5 lo permite.
  Ejemplo: VC = 7, llega el cuarto duplicado: VC = 8. Con 5 en vuelo, 5 < 8: envía uno nuevo.
- **A11. Salir de RR** (GG3.5). Con el primer **ACK nuevo** (que avanza): `VC = Umbral`, **tal cual** (aunque no sea entero y sin sumar los segmentos que reconoce), el Umbral no cambia, el modo pasa a EC y `contadorACKdup = 0`.
  Ejemplo: VC = 8, Umbral = 4, llega un ACK de 5 segmentos: VC = 4, EC.
- **A12. Vence el temporizador** (GG3.4 en AL; GG3.5 en EC y RR). Vale lo que diga la carta, en tics. Se arranca al enviar cuando no había nada en vuelo, se reinicia con cada ACK que avanza (si queda algo sin reconocer) y al retransmitir, y vence al comienzo del tic *t* + valor. Si en un tic llegan ACK y vence, se procesan primero los ACK. Al vencer, **en cualquier modo**: `Umbral = VC/2` (con la VC que tenga en ese momento, también la de RR), `VC = 1`, retransmite el segmento más antiguo sin reconocer, modo AL y `contadorACKdup = 0`. Quien avisa de que vence es el árbitro (decisión abierta 6).
  Ejemplo: VC = 8 → Umbral = 4, VC = 1, AL.
- **A13. Tahoe** (GG3.5). Es una opción de la partida; lo normal es Reno. Al tercer duplicado, en vez de A9: `Umbral = VC/2`, `VC = 1`, retransmite el más antiguo y modo AL. Los duplicados siguientes no cambian nada.
  Ejemplo: VC = 8 → Umbral = 4, VC = 1, AL.

Cuando el modo es AL o EC, A9 y A12 se aplican con la VC tal cual está, aunque sea fraccionaria: Umbral = (4 + 2/4)/2 = 2,25.

## 7. Reglas del servidor B (receptor)

- **B1. Llega un segmento en orden.** Si cabe en el sitio libre del búfer, se guarda y se actualiza `UltimoByteRecibido`. Si no cabe, se **descarta**: ni se guarda ni se reconoce.
- **B2. Ventana.** `VentRecepcion = BufferRecepcion − (UltimoByteRecibido − UltimoByteLeido)`, con `BufferRecepcion = 256` (en las cartas C, el de la carta: §3). Se calcula **en el tic en que sale el ACK**, con lo que la aplicación haya leído hasta entonces.
- **B3. Aviso de lectura.** Cuando el árbitro dice «tu aplicación ha leído *x*–*y*», se pone `UltimoByteLeido = y`.
- **B4. ACK retardado (CR3).** Si te llega un segmento en orden y no tenías ningún ACK pendiente, **no respondas en este tic**: apunta «ACK pendiente».
- **B5. ACK acumulativo (CR4).** En el tic siguiente envías el ACK pendiente, con AN = `UltimoByteRecibido + 1` y la W de B2. Si mientras tanto ha llegado otro segmento, ese mismo ACK los reconoce los dos.
- **B6. Actualización de ventana.** Si tu último ACK anunció **W = 0** y la aplicación libera sitio, en ese mismo tic envías un ACK con el mismo AN y la W nueva. Es lo que hacen los ejercicios y lo que evita el bloqueo mientras no hay sonda (decisión abierta 1).
- **B7. Llega un segmento fuera de orden** (solo en las cartas con pérdidas: C3, C6 y C7). Si cabe, **lo guardas**, pero no mueves `UltimoByteRecibido` ni la W: lo guardado fuera de orden no reduce la W. En ese mismo tic envías un ACK con el mismo AN y la misma W que tu ACK anterior (ACK duplicado inmediato).
- **B8. Se rellena el hueco.** Cuando llega el segmento que faltaba, `UltimoByteRecibido` salta hasta el final de lo que tienes seguido, y envías en ese mismo tic un ACK con ese AN (ACK inmediato). B no usa VC, Umbral ni modo: juega igual que siempre.

Valores iniciales: `UltimoByteRecibido = UltimoByteLeido = 1023`.

## 8. Reglas del árbitro

- Entrega las tarjetas **un tic después** de recibirlas, salvo las que la carta de escenario manda perder. En las cartas C, las pérdidas son siempre de un **primer envío**: la retransmisión de ese segmento llega.
- **Temporizador de A** (cartas C). Lleva la cuenta con las reglas de A12 y, al comienzo del tic en que vence, dice a A «vence tu temporizador».
- **Lecturas de la aplicación de B.** Con un retardo de lectura L, el aviso de que la aplicación ha leído un segmento llega **L tics después del aviso de que llegó**. Con L = 0, los dos avisos van juntos: «llegó 1024–1087 y tu aplicación ya lo ha leído». La aplicación lee los segmentos en orden, de uno en uno.
- **No ayuda ni corrige.** Si A envía fuera de la ventana o B se equivoca con el AN, el árbitro entrega la tarjeta tal cual y lo apunta en el registro. Los errores salen en la puesta en común.
- Solo interviene si alguien hace algo que el juego no permite: dos segmentos en un tic o mirar al otro lado del separador.
- La partida acaba cuando A levanta la mano (A4), o a los 25 tics.
- Al acabar, rellena la **tira del fichero** (§11) mirando solo el registro, antes de que nadie enseñe su hoja.

## 9. Cartas de escenario

### Cartas N (control de flujo)

Las reglas son las mismas en las tres; solo cambia L. A y B no saben qué carta tiene el árbitro.

| Carta | Aplicación de B | Pérdidas | Tic del ACK final (referencia) | Qué se ve |
|---|---|---|---|---|
| **N1. Lee al momento** | L = 0 | Ninguna | 7 | La W no baja: A solo vigila lo que tiene en vuelo |
| **N2. Lee despacio** | L = 2 | Ninguna | 8 | La W baja a 128 y A tiene que parar en el tic 5 |
| **N3. Se duerme** | L = 8 | Ninguna | 16 | W = 0 en el tic 5, A espera y la actualización de ventana sale en el tic 10 |

### Partida de referencia de N2, vista por cada jugador

| Tic | A sabe… | A envía | B sabe… | B envía |
|---|---|---|---|---|
| 1 | Nada; en vuelo 0, W = 256 | SN 1024 (1024–1087) | Nada | — |
| 2 | En vuelo 64 | SN 1088 | Llegó 1024–1087. Sin leer 64. ACK pendiente | — (CR3) |
| 3 | En vuelo 128 | SN 1152 | Llegó 1088–1151. Sin leer 128 | ACK AN 1152, W 128 |
| 4 | ACK 1152, W 128 → en vuelo 64; cabe uno | SN 1216 | Llegó 1152–1215; la aplicación leyó 1024–1087. Sin leer 128. ACK pendiente | — |
| 5 | En vuelo 128, W 128 → **no cabe** | — | Llegó 1216–1279; leyó 1088–1151. Sin leer 128 | ACK AN 1280, W 128 |
| 6 | ACK 1280, W 128 → en vuelo 0 | SN 1280 | Leyó 1152–1215 | — |
| 7 | En vuelo 64 | SN 1344 | Llegó 1280–1343; leyó 1216–1279. ACK pendiente | — |
| 8 | Ya lo ha enviado todo; espera | — | Llegó 1344–1407. Sin leer 128 | ACK AN 1408, W 128 |
| 9 | ACK 1408 → **fin** | | | |

En el tic 5, A cree que B tiene el búfer «casi lleno» y que no puede enviar. En realidad, B tiene 128 B sin leer y su aplicación está leyendo. Esa diferencia entre lo que A cree y lo que pasa es lo que se comenta en la puesta en común.

### Cartas C (control de congestión)

Las reglas de A son las de A1–A13 y las de B, las de B1–B8. Cambian el fichero, el búfer, el estado de partida de A, las pérdidas y el temporizador. A y B no saben qué carta tiene el árbitro, y A solo conoce lo suyo: su VC, su Umbral, su modo y el valor del temporizador. La columna de pérdidas es solo para el árbitro.

| Carta | Sesión | Fichero | Búfer de B, L | VC, Umbral, modo de partida | Pérdidas (solo árbitro) | Temporizador | Tic del ACK final (referencia) | Qué se ve |
|---|---|---|---|---|---|---|---|---|
| **C1. Conexión recién abierta** | GG3.4 | 8 segmentos (1024–1535) | 1024 B, L = 0 | 1, 16, AL | Ninguna | 6 | 13 | La VC pasa por 1, 2, 4, 6 y 8 sin llegar al Umbral. Limita la VC (tics 2, 3 y 6) y nunca la W |
| **C2. Conexión recién abierta con un umbral bajo** | GG3.4 y EC de GG3.5 | 10 segmentos (1024–1663) | 1024 B, L = 0 | 1, 5, AL | Ninguna | 6 | 15 | En el tic 10 un ACK de 2 segmentos lleva la VC de 4 a 5 + 1/5 y A pasa de AL a EC en mitad del ACK. Limita la VC (tics 2, 3 y 6) |
| **C3. Se pierde un segmento en el arranque lento** | GG3.4 | 9 segmentos (1024–1599) | 1024 B, L = 0 | 1, 16, AL | SN 1472 (primer envío, tic 11) | 3 | 16 | Solo llega un ACK duplicado (tic 14): no hay retransmisión rápida. Vence el temporizador en el tic 15: Umbral = 8/2 = 4, VC = 1, AL |
| **C4. Búfer pequeño y la aplicación lee despacio** | GG3.4 | 8 segmentos (1024–1535) | 256 B, L = 4 | 1, 16, AL | Ninguna | 6 | 15 | La W baja hasta 64. Limita la VC en los tics 2, 3 y 6, y la W en los tics 9, 11 y 12 |
| **C5. A mitad de conexión, sin pérdidas** | GG3.5 | 10 segmentos (1024–1663) | 1024 B, L = 0 | 4, 4, EC | Ninguna | 6 | 11 | EC pura: la VC pasa por 4 + 2/4, 5, 5 + 2/5 y 5 + 4/5. La VC no limita en ningún tic |
| **C6. A mitad de conexión, se pierde un segmento** | GG3.5 | 8 segmentos (1024–1535) | 1024 B, L = 0 | 8, 6, EC | SN 1024 (primer envío, tic 1) | 6 | 11 | Tres duplicados (tics 4, 5 y 6): Umbral = 4, VC = 7, RR. El cuarto (tic 7) sube la VC a 8. El ACK del tic 8 la baja a 4 y vuelve EC |
| **C7. A mitad de conexión, se pierde un segmento y el temporizador es corto** | GG3.5 | 8 segmentos (1024–1535) | 1024 B, L = 0 | 4, 4, EC | SN 1024 (primer envío, tic 1) | 4 | 11 | Vence el temporizador en el tic 5, con solo dos duplicados: Umbral = 2, VC = 1, AL. El ACK del tic 7 (4 segmentos) lleva la VC a 3 + 1/3 y pasa de AL a EC |

C3, C6 y C7 solo se pueden jugar con las reglas B7 y B8. C6 y C7 tienen la misma pérdida y distinto temporizador, y por eso se comparan.

### Partida de referencia de C2, vista por A

A ve la VC, el Umbral y el modo **después** de procesar lo que le llega en ese tic. «¿Envía?» es la comprobación de A5 (la W es 1024 y nunca limita).

| Tic | A recibe | VC | Umbral | Modo | En vuelo | ¿En vuelo < ⌊VC⌋? | A envía |
|---|---|---|---|---|---|---|---|
| 1 | — | 1 | 5 | AL | 0 | 0 < 1 sí | SN 1024 |
| 2 | — | 1 | 5 | AL | 1 | 1 < 1 no | — |
| 3 | — | 1 | 5 | AL | 1 | 1 < 1 no | — |
| 4 | ACK AN 1088 (1 segmento) | 2 | 5 | AL | 0 | 0 < 2 sí | SN 1088 |
| 5 | — | 2 | 5 | AL | 1 | 1 < 2 sí | SN 1152 |
| 6 | — | 2 | 5 | AL | 2 | 2 < 2 no | — |
| 7 | ACK AN 1216 (2 segmentos) | 4 | 5 | AL | 0 | 0 < 4 sí | SN 1216 |
| 8 | — | 4 | 5 | AL | 1 | 1 < 4 sí | SN 1280 |
| 9 | — | 4 | 5 | AL | 2 | 2 < 4 sí | SN 1344 |
| 10 | ACK AN 1344 (2 segmentos): 4 → 5 y EC; el segundo cuenta en EC | 5 + 1/5 | 5 | EC | 1 | 1 < 5 sí | SN 1408 |
| 11 | — | 5 + 1/5 | 5 | EC | 2 | 2 < 5 sí | SN 1472 |
| 12 | ACK AN 1472 (2 segmentos) | 5 + 3/5 | 5 | EC | 1 | 1 < 5 sí | SN 1536 |
| 13 | — | 5 + 3/5 | 5 | EC | 2 | 2 < 5 sí | SN 1600 |
| 14 | ACK AN 1600 (2 segmentos) | 6 | 5 | EC | 1 | 1 < 6 sí | — (ya lo ha enviado todo) |
| 15 | — | 6 | 5 | EC | 1 | sí | — (espera) |
| 16 | ACK AN 1664 | 6 + 1/6 | 5 | EC | 0 | | **fin** (A4) |

En los tics 2, 3 y 6, A tiene sitio en la W de sobra y sin embargo espera: lo que le para es la VC. B envía el ACK final en el tic 15, que es la referencia de C2.

### Partida de referencia de C6, vista por A

A no sabe que el segmento SN 1024 se ha perdido. En los tics 4 y 5 solo ve ACK que repiten el AN 1024 y sigue enviando, porque la VC lo permite.

| Tic | A recibe | VC | Umbral | Modo | En vuelo | ¿En vuelo < ⌊VC⌋? | A envía |
|---|---|---|---|---|---|---|---|
| 1 | — | 8 | 6 | EC | 0 | 0 < 8 sí | SN 1024 |
| 2 | — | 8 | 6 | EC | 1 | 1 < 8 sí | SN 1088 |
| 3 | — | 8 | 6 | EC | 2 | 2 < 8 sí | SN 1152 |
| 4 | ACK AN 1024 (duplicado 1) | 8 | 6 | EC | 3 | 3 < 8 sí | SN 1216 |
| 5 | ACK AN 1024 (duplicado 2) | 8 | 6 | EC | 4 | 4 < 8 sí | SN 1280 |
| 6 | ACK AN 1024 (duplicado 3): Umbral = 8/2 = 4, VC = 4 + 3 | 7 | 4 | RR | 5 | 5 < 7 sí | Retransmite SN 1024 |
| 7 | ACK AN 1024 (duplicado 4): VC + 1 | 8 | 4 | RR | 5 | 5 < 8 sí | SN 1344 (nuevo) |
| 8 | ACK AN 1344 (5 segmentos): sale de RR, VC = Umbral | 4 | 4 | EC | 1 | 1 < 4 sí | SN 1408 |
| 9 | — | 4 | 4 | EC | 2 | 2 < 4 sí | SN 1472 |
| 10 | ACK AN 1472 (2 segmentos) | 4 + 2/4 | 4 | EC | 1 | 1 < 4 sí | — (ya lo ha enviado todo) |
| 11 | — | 4 + 2/4 | 4 | EC | 1 | sí | — (espera) |
| 12 | ACK AN 1536 | 4 + 3/4 | 4 | EC | 0 | | **fin** (A4) |

En el tic 6, A hace la retransmisión rápida sin esperar al temporizador. Con la VC de 7 todavía puede enviar un segmento nuevo en el tic 7. El ACK final sale en el tic 11, que es la referencia de C6. Con Tahoe en la misma carta, A no podría enviar nada nuevo en el tic 7 (VC = 1) y el ACK final saldría en el tic 12.

## 10. Hojas de estado

**Hoja de A en las cartas N**

| Tic | Eventos (ACK recibidos: AN, W) | UltimoByteReconocido | VentRecepcion | UltimoByteEnviado | En vuelo + 64 ≤ W? | Envío (SN) |
|---|---|---|---|---|---|---|
| 1 | — | 1023 | 256 | 1023 | 0 + 64 ≤ 256 sí | 1024 |
| … | | | | | | |

**Hoja de A en las cartas C**

Añade cuatro columnas: VC, Umbral, Modo y la comprobación de A5. Los duplicados se cuentan en la columna de eventos, y los segmentos en vuelo son `(UltimoByteEnviado − UltimoByteReconocido) / 64`.

| Tic | Eventos (ACK recibidos: AN, W; duplicado nº; «vence») | UltimoByteReconocido | VentRecepcion | VentCongestion | Umbral | Modo | UltimoByteEnviado | ¿En vuelo < ⌊VC⌋ y cabe en W? | Envío (SN) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | — | 1023 | 1024 | 1 | 5 | AL | 1023 | 0 < 1 y 64 ≤ 1024: sí | 1024 |
| … | | | | | | | | | |

La fila 1 es la de C2. La VC, el Umbral y el modo de la fila 1 son los de partida de la carta (§3). Las filas siguientes se rellenan con A6–A13.

**Hoja de B**

| Tic | Eventos (llegadas, lecturas) | UltimoByteRecibido | UltimoByteLeido | Sin leer | VentRecepcion | ¿ACK pendiente? | Envío (AN, W) |
|---|---|---|---|---|---|---|---|
| 1 | — | 1023 | 1023 | 0 | 256 | no | — |
| … | | | | | | | |

**La hoja de B no cambia** en las cartas C: las reglas B7 y B8 usan las mismas columnas (lo guardado fuera de orden se apunta en «Eventos»). Junto a la hoja de B conviene dibujar el búfer como **4 casillas de 64 B** (16 en las cartas C con búfer de 1024 B) e ir marcando cada una como recibida, leída o libre, como en la figura 3.38 de Kurose.

## 11. Puesta en común

El árbitro ordena las tarjetas en su plantilla de dos líneas de vida y marca las perdidas. Después, los tres:

1. Comparan cada hoja con el registro: ¿en qué tic se equivocó cada uno con una variable, si se equivocó?
2. Buscan un tic en el que A **creyera** algo del búfer de B que no era cierto. ¿Por qué no podía saberlo?
3. Comprueban si B descartó algún segmento (B1) y quién tuvo la culpa.
4. Solo en N3: ¿qué habría pasado si B no hubiera enviado la actualización del tic 10? Es la pregunta que lleva a la sonda.

Para las cartas C, además:

5. ¿En qué tics limitó la VC a A y en cuáles la W? En C4 pasan las dos cosas: ¿cuál de las dos mandaba en cada momento?
6. En C3, C6 y C7, A no supo que se había perdido un segmento hasta cierto tic. ¿Cuál? ¿Qué vio A entre la pérdida y ese tic, y por qué no podía distinguirlo de un simple retraso?
7. ¿Qué habría pasado con Tahoe? En C6, ¿en qué tic sale el ACK final y qué hace A en el tic 7?
8. ¿Por qué se trata peor el vencimiento del temporizador (VC = 1) que los tres duplicados (VC = Umbral + 3)? Compara C6 y C7: misma pérdida, distinto aviso.
9. Dibujad entre los tres la gráfica de la VC por tics, con el Umbral como línea horizontal (cuando cambie, un escalón), como la figura de Tahoe y Reno de Kurose (§3.7). Marcad en ella cada cambio de modo.

### Resultado de la partida

Lo primero que se anuncia es cómo acabó la transferencia. Se decide por lo que **B tiene de verdad** según el registro, no por lo que cree A: que A levante la mano solo dice que le ha llegado un ACK con el AN que cierra el fichero (1408 con 6 segmentos).

**La tira del fichero.** El árbitro dibuja una casilla por cada trozo de 64 B del fichero (seis en las cartas N; ocho, nueve o diez en las C) y marca cada una según el registro:

```
┌──────┬──────┬──────┬──────┬──────┬──────┐
│ 1024 │ 1088 │ 1152 │ 1216 │ 1280 │ 1344 │
├──────┼──────┼──────┼──────┼──────┼──────┤
│  ■   │  ✗   │  □   │  □   │  □   │  ✗   │
└──────┴──────┴──────┴──────┴──────┴──────┘
 ■ en orden: B lo guardó y tiene todo lo anterior
 □ fuera de orden: B lo guardó, pero le falta algo anterior
 ✗ falta: nunca le llegó a B, o lo descartó (B1)
```

**El resultado** sale de la tira, del tic del ACK final y de la referencia de la carta (§9):

| Resultado | Cuándo | Qué se comenta |
|---|---|---|
| **Fichero completo, de la mejor manera posible** | Todas las casillas en orden y el ACK con el AN final sale en el tic de la referencia | Si hubo tarjetas distintas de las de TCP que no retrasaron, se señalan igual |
| **Fichero completo, pero más lento** | Todas en orden, pero el ACK final sale después de la referencia | La primera decisión distinta de TCP: casi siempre explica el retraso |
| **Fichero completo y antes que TCP, pero saltándose una regla** | Todas en orden y el ACK final sale **antes** de la referencia | Solo pasa si A envió fuera de la ventana (A1) y ese segmento cupo por suerte: A no podía saberlo |
| **Faltan fragmentos** o **fichero desordenado** | A levantó la mano, pero alguna casilla está en □ o ✗ | El tic en que B envió un AN mayor que `UltimoByteRecibido + 1`: A dio por entregados octetos que B no tenía y ya no iba a reenviarlos |
| **La transferencia no terminó** | A los 25 tics A no ha levantado la mano | Si la tira está completa, B lo tiene todo pero A no lo sabe (falta el ACK final). Si no, ¿qué se quedó esperando cada uno? |

Los dos últimos resultados son los graves: la transferencia ha fallado y no hay puntuación.

**Puntuación** (menos es mejor), solo si el fichero está completo: el tic en que B envió el ACK con AN igual al final del fichero (1408 con 6 segmentos), más 2 por cada segmento descartado y 1 por cada valor erróneo de SN, AN o W en una tarjeta. En las cartas C, un valor erróneo de VC, Umbral o modo en la hoja de A cuenta 1, como cualquier otro valor erróneo de la hoja. Se compara con la referencia del §9 y con los demás tríos que hayan jugado la misma carta.

## 12. Fuera de esta versión

- **Segmento de sondeo** de ventana cero: se dejará para la siguiente versión. Con la sonda, B6 podría dejar de ser una regla y la actualización de ventana podría perderse.
- **Pérdidas y temporizador en las cartas N**: ya están en la versión web (escenarios P1–P5 y «Pérdidas al azar») con el modelo de los ejercicios. Hay un temporizador único que, al vencer, retransmite solo el segmento más antiguo. B guarda lo que llega fuera de orden y envía un ACK duplicado inmediato (CR5) y un ACK inmediato al rellenar el hueco (CR6). Lo guardado fuera de orden no reduce la W, y la red puede perder también ACK. Como en los ejercicios, la partida elige qué hace B con lo que llega fuera de orden: lo guarda (y A, al vencer, reenvía solo el más antiguo) o lo descarta (y A reenvía el más antiguo y después toda la cola, uno por tic). La retransmisión rápida (tercer ACK duplicado, Kurose fig. 3.37) es otra opción de la partida, activada por defecto; desactivada, el juego da los mismos tics que los ejercicios de control de flujo, que no la usan. **Falta pasar a cartas de papel** las pérdidas P1–P5 y las pérdidas al azar, con control de flujo solo. Las cartas C sí están descritas en este reglamento (§6, §9 y §10) y en la versión web, con pérdidas, temporizador (A12) y las reglas B7 y B8.
- **Versión web**: prototipo del modo individual en `web/` (el alumno juega A o B y el programa hace de la otra parte, de la red y de la aplicación de B). Se abre `web/index.html` en el navegador y las pruebas de `tests/` comprueban el motor contra las soluciones de referencia de los ejercicios y las trazas del simulador. Hay dos simplificaciones para que un error no deje la partida bloqueada: B descarta lo que no cabe y responde con un ACK inmediato, y el temporizador de A lo gestiona el juego. Al final, la versión web muestra la misma tira del fichero y los mismos resultados del §11. Con congestión, ofrece las cartas C1–C7 y la opción Reno o Tahoe.
- **Dos simplificaciones del modelo de congestión frente a TCP real**, por si algún alumno pregunta:
  - **El Umbral se calcula con `VC/2`**, como en Kurose y en las diapositivas, y no con los datos que hay en vuelo, como hace la RFC 5681 (que además no lo deja bajar de 2 MSS). Aquí puede quedar por debajo de 2 MSS: con VC = 1, un vencimiento da Umbral = 0,5.
  - **En AL se suma 1 MSS por cada segmento reconocido**, no por cada ACK. Con el ACK retardado de B, un ACK reconoce dos segmentos y la VC sube 2, mientras que la RFC 5681 suma como mucho 1 MSS por ACK. La VC crece algo más deprisa que en una implementación estricta (en C1, 1, 2, 4, 6, 8, y no una duplicación por ronda).

## 13. Decisiones abiertas

1. **B6, la actualización de ventana**: ¿es una regla, como en los ejercicios (recomendado mientras no haya sonda), o se deja a B que descubra que tiene que enviarla? En el segundo caso, si B no la envía la partida se bloquea, que es justo el problema de Kurose.
2. **ACK retardado desde N1** (recomendado, por coherencia con CR1–CR6 y el examen), o ACK inmediato en N1 para que la primera partida sea más fácil.
3. **Quién hace de árbitro**: un alumno en cada trío (recomendado para probarlo en papel), o el profesor para varias parejas a la vez.
4. **¿Sabe B el tamaño del fichero?** Recomendado que no, porque TCP no lo sabe.
5. **Duración**: cada partida dura de 10 a 20 tics, unos 10–15 minutos. Las tres cartas N no caben en una sesión: ¿N2 y N3 en clase y N1 como calentamiento de 5 minutos?
6. **Quién lleva el temporizador en las cartas con pérdidas (C3, C6 y C7)**: que el árbitro cuente y avise «vence tu temporizador» (recomendado: es lo que hace la web y A no tiene que contar tics a la vez que decide), que lo cuente A en su hoja (más fiel, pero un error de cuenta cambia la partida), o un reloj de arena o cronómetro para todo el trío.
7. **¿La hoja de A lleva `Cvc`?** Recomendado que no: `Cvc` no está en Kurose, y la comprobación «en vuelo < ⌊VC⌋» de la hoja da lo mismo. Si el grupo sigue las diapositivas con `Cvc`, se puede añadir como columna extra: `Cvc = VC − en vuelo`.
8. **Cuántas cartas C caben en una sesión**: cada una dura de 11 a 16 tics, y rotar los tres papeles ocupa tres partidas. Recomendado: dos cartas por sesión (C2 y C3 tras GG3.4; C5 y C6 tras GG3.5), con A rotando entre los alumnos, y dejar C1, C4 y C7 para la versión web o para la sesión siguiente.
9. **Reno o Tahoe**: recomendado jugar Reno (el modelo de clase) y pasar C6 con Tahoe solo en la puesta en común, como pregunta, sin repartir una carta nueva.
