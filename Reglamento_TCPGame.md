# TCPGame: reglamento v0.2 (control de flujo, sin segmento de sondeo)

> Borrador del 2026-11-07. Usa el mismo modelo de tiempo y las mismas reglas que el simulador de ejercicios de secuencias TCP de la asignatura, y los números de los ejercicios de clase sobre control de flujo: A envía 6 × 64 B a B, que tiene un búfer de 256 B. Las tres partidas de referencia del §9 coinciden tic a tic con las soluciones de esos ejercicios. Variables con los nombres de Kurose (edición en español). Los tics se cuentan desde 1, como en los ejercicios.

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

### Lo que sabe y lo que no sabe cada uno

| | Sabe | No sabe |
|---|---|---|
| **A** | El tamaño del fichero (384 B, del 1024 al 1407), lo que ha enviado y los ACK que le han llegado | Cuánto tiene B en el búfer, cuándo lee su aplicación, si algo se ha perdido o va de camino |
| **B** | Lo que le ha llegado, lo que ha leído su aplicación y lo que ha anunciado | Cuánto ocupa el fichero, cuántos segmentos le quedan por llegar, cuándo leerá su aplicación |

## 4. Cómo se juega un tic

Cada tic tiene cuatro pasos. El árbitro dice en voz alta «Tic *n*».

1. **Eventos.** El árbitro entrega a cada jugador, boca abajo, las tarjetas que le llegaron en el tic anterior. A B le dice también, si toca, «tu aplicación ha leído los octetos *x*–*y*» (§7).
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
- **A4. Fin.** Cuando A recibe un ACK con **AN = 1408**, levanta la mano: **cree** que el fichero ha llegado entero. Si es verdad o no lo comprueba el árbitro en la puesta en común (§11).

Valores iniciales: `UltimoByteEnviado = UltimoByteReconocido = 1023` y `VentRecepcion = 256`.

## 7. Reglas del servidor B (receptor)

- **B1. Llega un segmento en orden.** Si cabe en el sitio libre del búfer, se guarda y se actualiza `UltimoByteRecibido`. Si no cabe, se **descarta**: ni se guarda ni se reconoce.
- **B2. Ventana.** `VentRecepcion = BufferRecepcion − (UltimoByteRecibido − UltimoByteLeido)`, con `BufferRecepcion = 256`. Se calcula **en el tic en que sale el ACK**, con lo que la aplicación haya leído hasta entonces.
- **B3. Aviso de lectura.** Cuando el árbitro dice «tu aplicación ha leído *x*–*y*», se pone `UltimoByteLeido = y`.
- **B4. ACK retardado (CR3).** Si te llega un segmento en orden y no tenías ningún ACK pendiente, **no respondas en este tic**: apunta «ACK pendiente».
- **B5. ACK acumulativo (CR4).** En el tic siguiente envías el ACK pendiente, con AN = `UltimoByteRecibido + 1` y la W de B2. Si mientras tanto ha llegado otro segmento, ese mismo ACK los reconoce los dos.
- **B6. Actualización de ventana.** Si tu último ACK anunció **W = 0** y la aplicación libera sitio, en ese mismo tic envías un ACK con el mismo AN y la W nueva. Es lo que hacen los ejercicios y lo que evita el bloqueo mientras no hay sonda (decisión abierta 1).

Valores iniciales: `UltimoByteRecibido = UltimoByteLeido = 1023`.

## 8. Reglas del árbitro

- Entrega las tarjetas **un tic después** de recibirlas, salvo las que la carta de escenario manda perder.
- **Lecturas de la aplicación de B.** Con un retardo de lectura L, el aviso de que la aplicación ha leído un segmento llega **L tics después del aviso de que llegó**. Con L = 0, los dos avisos van juntos: «llegó 1024–1087 y tu aplicación ya lo ha leído». La aplicación lee los segmentos en orden, de uno en uno.
- **No ayuda ni corrige.** Si A envía fuera de la ventana o B se equivoca con el AN, el árbitro entrega la tarjeta tal cual y lo apunta en el registro. Los errores salen en la puesta en común.
- Solo interviene si alguien hace algo que el juego no permite: dos segmentos en un tic o mirar al otro lado del separador.
- La partida acaba cuando A levanta la mano (A4), o a los 25 tics.
- Al acabar, rellena la **tira del fichero** (§11) mirando solo el registro, antes de que nadie enseñe su hoja.

## 9. Cartas de escenario

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

## 10. Hojas de estado

**Hoja de A**

| Tic | Eventos (ACK recibidos: AN, W) | UltimoByteReconocido | VentRecepcion | UltimoByteEnviado | En vuelo + 64 ≤ W? | Envío (SN) |
|---|---|---|---|---|---|---|
| 1 | — | 1023 | 256 | 1023 | 0 + 64 ≤ 256 sí | 1024 |
| … | | | | | | |

**Hoja de B**

| Tic | Eventos (llegadas, lecturas) | UltimoByteRecibido | UltimoByteLeido | Sin leer | VentRecepcion | ¿ACK pendiente? | Envío (AN, W) |
|---|---|---|---|---|---|---|---|
| 1 | — | 1023 | 1023 | 0 | 256 | no | — |
| … | | | | | | | |

Junto a la hoja de B conviene dibujar el búfer como **4 casillas de 64 B** e ir marcando cada una como recibida, leída o libre, como en la figura 3.38 de Kurose.

## 11. Puesta en común

El árbitro ordena las tarjetas en su plantilla de dos líneas de vida y marca las perdidas. Después, los tres:

1. Comparan cada hoja con el registro: ¿en qué tic se equivocó cada uno con una variable, si se equivocó?
2. Buscan un tic en el que A **creyera** algo del búfer de B que no era cierto. ¿Por qué no podía saberlo?
3. Comprueban si B descartó algún segmento (B1) y quién tuvo la culpa.
4. Solo en N3: ¿qué habría pasado si B no hubiera enviado la actualización del tic 10? Es la pregunta que lleva a la sonda.

### Resultado de la partida

Lo primero que se anuncia es cómo acabó la transferencia. Se decide por lo que **B tiene de verdad** según el registro, no por lo que cree A: que A levante la mano solo dice que le ha llegado un ACK con AN = 1408.

**La tira del fichero.** El árbitro dibuja seis casillas, una por cada trozo de 64 B del fichero, y marca cada una según el registro:

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
| **Fichero completo, de la mejor manera posible** | Las seis casillas en orden y el ACK con AN = 1408 sale en el tic de la referencia | Si hubo tarjetas distintas de las de TCP que no retrasaron, se señalan igual |
| **Fichero completo, pero más lento** | Las seis en orden, pero el ACK final sale después de la referencia | La primera decisión distinta de TCP: casi siempre explica el retraso |
| **Fichero completo y antes que TCP, pero saltándose una regla** | Las seis en orden y el ACK final sale **antes** de la referencia | Solo pasa si A envió fuera de la ventana (A1) y ese segmento cupo por suerte: A no podía saberlo |
| **Faltan fragmentos** o **fichero desordenado** | A levantó la mano, pero alguna casilla está en □ o ✗ | El tic en que B envió un AN mayor que `UltimoByteRecibido + 1`: A dio por entregados octetos que B no tenía y ya no iba a reenviarlos |
| **La transferencia no terminó** | A los 25 tics A no ha levantado la mano | Si la tira está completa, B lo tiene todo pero A no lo sabe (falta el ACK final). Si no, ¿qué se quedó esperando cada uno? |

Los dos últimos resultados son los graves: la transferencia ha fallado y no hay puntuación.

**Puntuación** (menos es mejor), solo si el fichero está completo: el tic en que B envió el ACK con AN = 1408, más 2 por cada segmento descartado y 1 por cada valor erróneo de SN, AN o W en una tarjeta. Se compara con la referencia del §9 y con los demás tríos que hayan jugado la misma carta.

## 12. Fuera de esta versión

- **Segmento de sondeo** de ventana cero: se dejará para la siguiente versión. Con la sonda, B6 podría dejar de ser una regla y la actualización de ventana podría perderse.
- **Pérdidas y temporizador**: ya están en la versión web (escenarios P1–P5 y «Pérdidas al azar») con el modelo de los ejercicios. Hay un temporizador único que, al vencer, retransmite solo el segmento más antiguo. B guarda lo que llega fuera de orden y envía un ACK duplicado inmediato (CR5) y un ACK inmediato al rellenar el hueco (CR6). Lo guardado fuera de orden no reduce la W, y la red puede perder también ACK. Como en los ejercicios, la partida elige qué hace B con lo que llega fuera de orden: lo guarda (y A, al vencer, reenvía solo el más antiguo) o lo descarta (y A reenvía el más antiguo y después toda la cola, uno por tic). La retransmisión rápida (tercer ACK duplicado, Kurose fig. 3.37) es otra opción de la partida, activada por defecto; desactivada, el juego da los mismos tics que los ejercicios de control de flujo, que no la usan. Falta pasarlo a cartas para la versión en papel.
- **Versión web**: prototipo del modo individual en `web/` (el alumno juega A o B y el programa hace de la otra parte, de la red y de la aplicación de B). Se abre `web/index.html` en el navegador y `node tests/pruebas_motor.js` comprueba el motor contra las soluciones de referencia (`tests/trazas_referencia.json`). Hay dos simplificaciones para que un error no deje la partida bloqueada: B descarta lo que no cabe y responde con un ACK inmediato, y el temporizador de A lo gestiona el juego. Al final, la versión web muestra la misma tira del fichero y los mismos resultados del §11.

## 13. Decisiones abiertas

1. **B6, la actualización de ventana**: ¿es una regla, como en los ejercicios (recomendado mientras no haya sonda), o se deja a B que descubra que tiene que enviarla? En el segundo caso, si B no la envía la partida se bloquea, que es justo el problema de Kurose.
2. **ACK retardado desde N1** (recomendado, por coherencia con CR1–CR6 y el examen), o ACK inmediato en N1 para que la primera partida sea más fácil.
3. **Quién hace de árbitro**: un alumno en cada trío (recomendado para probarlo en papel), o el profesor para varias parejas a la vez.
4. **¿Sabe B el tamaño del fichero?** Recomendado que no, porque TCP no lo sabe.
5. **Duración**: cada partida dura de 10 a 20 tics, unos 10–15 minutos. Las tres cartas no caben en una sesión: ¿N2 y N3 en clase y N1 como calentamiento de 5 minutos?
