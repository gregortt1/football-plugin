# Fútbol en vivo — plugin de Kino

Partidos y canales deportivos dentro de la pestaña **En vivo** de Kino: Champions, Europa
League, La Liga, Premier League, Serie A, Bundesliga, Ligue 1, Liga MX, Brasileirão, Liga
Profesional y el resto de ligas de Sudamérica, más los canales deportivos para cuando no hay
partidos.

## Cómo se instala

1. Abre Kino y entra en **Plugins** (menú ☰ en el teléfono, Ajustes en la TV).
2. Toca **+** y escribe la dirección del repositorio:

   ```
   gregortt1/football-plugin
   ```

3. Acepta e instala. Kino te va a avisar de dos cosas: que agrega canales en vivo a la pestaña
   En vivo, y que puede reproducir canales desde cualquier servidor que indique su lista.

El plugin no está en la tienda de Kino: solo se instala escribiendo esa dirección. Para
actualizarlo, entra en **Plugins ▸ Instalados** y busca la actualización; no hace falta
desinstalar.

## Qué vas a ver

Todo aparece en **En vivo**, en tres filas con el nombre del plugin:

**Partidos en vivo** — solo lo que está jugando ahora (o arranca en los próximos 10 minutos).
Un partido que empieza a las nueve de la noche no aparece acá a las tres de la tarde.

**Canales deportivos** — el directorio completo, siempre disponible. Si no hay partidos a esta
hora, acá hay algo.

**Próximos partidos** — la agenda que todavía no empezó, con la hora delante
(`15:00 · Le Havre vs PSG`) y `mañana` cuando el partido cae después de medianoche. Si lo
abres antes de la hora, Kino te dice a qué hora empieza en vez de abrir una señal muerta.

Cada partido lleva su carátula con los dos equipos sobre el color de la competición; cada canal
lleva su logo. La búsqueda de En vivo encuentra equipos y canales por nombre, y la guía de TV
muestra a qué hora empieza cada partido.

## Los ESPN y Fox Sports vienen por país

Un ESPN 2 de Argentina no es el ESPN 2 de México: son señales distintas, con relato y publicidad
distintos. Por eso esos canales aparecen separados y con el país en el nombre:

```
ESPN 1 (Argentina)     ESPN 1 (México)
ESPN 2 (Argentina)     ESPN 2 (México)
ESPN 3 (Argentina)     ESPN 3 (México)
Fox Sports 1 (Argentina)   Fox Sports 1 (México)
Fox Sports 2 (Argentina)   Fox Sports 2 (México)
Fox Sports 3 (Argentina)   Fox Sports 3 (México)
```

Lo que elegís es lo que ves: el plugin nunca te cambia una señal argentina por una mexicana sin
avisarte. El resto de los canales va con su nombre a secas, porque no tiene esa ambigüedad.

## Cuando una señal no anda

Cada canal tiene una o varias fuentes. El plugin las recorre en orden, saltea las que el propio
sitio ya marca como caídas, y antes de darte una señal comprueba que el manifiesto responda
**y** que el primer fragmento de video exista. Si ninguna responde, Kino te avisa en vez de
dejarte mirando una pantalla negra.

Igual pasa: estas señales son de terceros y se caen sin aviso. Si un canal no abre, probá otro
rato o abrí otro canal; no es algo que el plugin pueda arreglar desde acá.

No se listan partidos de fútbol femenino, ni deportes que no son fútbol (pádel, tenis, F1, NBA,
NFL, MLB, MotoGP, boxeo, golf), aunque la agenda del sitio los incluya.

## Si algo no aparece

- **No veo la pestaña En vivo con el plugin**: revisá que la instalación haya terminado y que el
  consentimiento de canales en vivo esté aceptado.
- **Los canales tardan en cambiar**: Kino guarda la lista de canales una hora. Si acaba de
  empezar un partido y todavía no aparece, esperá o reiniciá la app.
- **Kino pide una versión más nueva**: el plugin usa la versión de plugins más reciente de Kino.

Para reportar algo, abrí el plugin en **Plugins ▸ Instalados**, activá **Modo debug** y mandá el
registro junto con el nombre del canal o del partido.
