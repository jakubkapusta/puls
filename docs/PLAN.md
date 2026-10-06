# Puls

> Breakout, w którym każdy klocek jest nutą, a utwór powstaje z tego, jak grasz.

**Mieszanka:** Breakout/Arkanoid × gra rytmiczna × sekwencer muzyczny
**Status:** w realizacji od 2026-10-06. Pomysł: `~/code/plany/puls.md`. Ten dokument jest źródłem prawdy dla kamieni milowych.

---

## Ustalenia (decyzje właściciela)

| Temat | Decyzja |
|---|---|
| Orientacja | **Plansza zawsze pionowa.** Na telefonie w poziomie i na laptopie plansza jest kolumną na środku, a boki wypełnia tło reagujące na muzykę. Obrót telefonu w trakcie gry nie może niczego zepsuć. |
| Utrata piłki | **Życia + muzyka cichnie.** Kilka żyć na utwór. Spadek piłki: mnożnik się zeruje, jedna warstwa muzyki gaśnie, piłka wraca na paletkę. Utrata wszystkich żyć kończy poziom z wynikiem, ale bez zaliczenia. |
| Trafienie w rytm | **Piłka w rytmie + uderzenie.** Gra delikatnie dopasowuje prędkość piłki, żeby spadała na paletkę na bit, więc całość „tańczy” z muzyką. Gracz może dodatkowo **uderzyć** (szybki ruch palca w górę, spacja, klik). Uderzenie w momencie kontaktu = trafienie w rytm: mnożnik, piłka się rozgrzewa. Samo złapanie też odbija piłkę, ale bez bonusu. |
| Zakres przed testem | **M0–M1, potem STOP.** Czucie odbijania i rytmu z prostą grafiką i jednym utworem. Efekty wow i 5 utworów dopiero po teście właściciela na telefonie. |
| Język | Tekst dla gracza po polsku. Kod, komentarze i nazwy w kodzie po angielsku. Commity po polsku. |

---

## Formuła rozgrywki

### Pętla

Poziom to jeden utwór (2–3 minuty). Na górze planszy wiszą klocki ułożone we frazy melodii, na dole jest paletka. W tle od początku gra podkład (bas i stopa). Zbijasz klocki, każdy gra swoją nutę wyrównaną do siatki rytmu. Zbite rzędy i klocki specjalne dokładają warstwy (hi-hat, werbel, pad, arpeggio, melodia), więc utwór rośnie razem z postępem.

Poziom kończy się:
- **zbiciem wszystkich klocków:** finał (wielki akord, wszystkie warstwy, premia za pozostały czas utworu), zaliczenie,
- **końcem utworu:** zaliczenie, jeśli zbito wystarczającą część klocków (próg z balansu), inaczej wynik bez zaliczenia,
- **utratą wszystkich żyć:** wynik bez zaliczenia.

Od końca poziomu do „jeszcze raz” ma mijać chwila, a przycisk jest pod kciukiem.

### Klocek to nuta

- Każdy klocek ma nutę zapisaną w utworze. **Rząd to fraza:** czytany od lewej do prawej rząd tworzy kawałek melodii. Niższe rzędy grają niżej, wyższe wyżej.
- Wszystkie nuty należą do skali utworu, a progresja akordów podkładu jest dobrana tak, żeby żadna nuta skali nie gryzła się z akordem (w synthwave: pentatonika molowa nad progresją w tym samym trybie).
- **Kwantyzacja:** trafienie jest przesuwane do najbliższej szesnastki. Jeśli trafienie wypadło tuż po szesnastce, nuta gra od razu, w przeciwnym razie czeka na następną. Klocek rozpada się wizualnie od razu (natychmiastowa reakcja), a błysk nuty i drobna fala przychodzą razem z dźwiękiem.
- **Barwa zależy od koloru klocka**, kolor zależy od rodzaju (zwykły, akord, twardy itd.).

### Piłka w rytmie

- Kiedy piłka leci w dół i nic już nie stoi jej na drodze, gra wylicza, kiedy doleci do paletki, i płynnie dopasowuje jej prędkość tak, żeby kontakt wypadł na bit. Jeśli bit nie mieści się w zakresie prędkości, celuje w ósemkę, a w ostateczności w szesnastkę (przy 100 BPM sam bit często jest poza zasięgiem).
- Nad linią paletki, w miejscu lądowania, zamyka się pierścień, który odlicza moment kontaktu. To główna podpowiedź, kiedy uderzyć. Zmiana prędkości ma być niezauważalna jako „szarpnięcie”: działa przez cały lot w dół, w wąskim zakresie wokół prędkości bazowej.
- Jeśli żaden bit nie mieści się w zakresie, piłka leci bez synchronizacji (rzadkie, np. tuż po odbiciu od klocka nisko nad paletką).
- Zsynchronizowany jest moment, w którym gracz **słyszy** bit, czyli uwzględniamy opóźnienie wyjścia audio i kalibrację.

### Uderzenie

- **Telefon:** szybki ruch palca w górę (palec nadal prowadzi paletkę). **Laptop:** spacja, klik albo strzałka w górę.
- Uderzenie podrzuca paletkę na krótko do góry (widać zamach).
- Uderzenie blisko chwili kontaktu (przed albo tuż po odbiciu) liczy się jako **trafienie w rytm**. Okno jest szerokie i ma dwa progi: idealne i dobre. Mierzymy względem zaplanowanego bitu, a nie samego kontaktu (zamach podnosi paletkę, więc piłka dotyka jej odrobinę wcześniej).
- Trafienie w rytm: mnożnik rośnie, piłka się rozgrzewa (kolor od chłodnego do białego żaru), rośnie jej moc. Rozgrzana piłka przebija słabe klocki zamiast się od nich odbijać i gra mocniejszą barwą.
- Seria trafień w rytm daje stan **„w rytmie”**: pełne efekty, dodatkowa warstwa (np. lead) gra, dopóki seria trwa.
- Odbicie bez uderzenia albo uderzenie nie w porę: piłka stygnie o stopień, mnożnik nie rośnie (nie zeruje się). Zeruje go dopiero utrata piłki.
- Uderzenie w powietrze (gdy piłka daleko) nic nie psuje, poza krótkim czasem odnowienia, żeby nie dało się „machać” bez przerwy.

### Odbicie

- Kąt odbicia zależy od miejsca trafienia paletką (jak w Arkanoidzie): środek pionowo, krawędzie ostro w bok. Nigdy prawie poziomo.
- Piłka nie może utknąć w pętli poziomej ani pionowej: jeśli długo nie dotyka paletki, lekko korygujemy kąt.
- Start: piłka leży na paletce, wystrzał stuknięciem / spacją (po kilku sekundach sama).

### Życia i warstwy

- Utrata piłki: dźwięk opadającego filtra, jedna warstwa gaśnie (najmłodsza), mnożnik do zera, stan „w rytmie” znika, piłka wraca na paletkę.
- Warstwy dochodzą: co zbity rząd (albo klocek perkusji w M3). Kolejność warstw jest częścią utworu.

### Punkty

- Klocek: punkty bazowe × mnożnik. Rozgrzana piłka daje więcej.
- Trafienie w rytm: premia (idealne > dobre).
- Koniec utworu: premia za życia, za zbite klocki, a przy zbiciu wszystkiego za pozostałe takty.
- Wynik i gwiazdki (M4) zapisywane per utwór.

---

## Muzyka

### Zegar

**Zegar audio jest nadrzędny.** Czas utworu liczymy z `AudioContext.currentTime` (minus moment startu), a nie z klatek. Sekwencer planuje nuty z wyprzedzeniem (klasyczny wzorzec „lookahead scheduler”: co kilkanaście ms dokładamy nuty, które wypadają w najbliższym oknie). Logika gry porównuje swoje zdarzenia z czasem słyszanym:

`słyszany czas = currentTime − start − outputLatency − kalibracja`

### Kalibracja

- Ekran kalibracji przy pierwszym uruchomieniu (do pominięcia) i w ustawieniach: gra puszcza kliknięcia, gracz stuka w rytm, mediana przesunięcia zostaje zapisana.
- Wartość per urządzenie w `localStorage`. Dodatkowo ręczny suwak.
- Informacja dla iOS: dźwięk startuje po pierwszym dotknięciu, przełącznik wyciszenia blokuje dźwięk.

### Format utworu

Utwór to plik TypeScript z danymi (bez plików audio):
- tempo, skala (tonika + tryb), progresja akordów (po takcie), długość w taktach,
- **układ klocków:** rzędy jako napisy, w których każdy znak to stopień skali albo puste miejsce (wizualnie czytelne w kodzie), plus znaczniki klocków specjalnych,
- **warstwy:** lista instrumentów z wzorcami (stopa, werbel, hi-hat, bas, pad, arpeggio, lead), z kolejnością dokładania,
- **struktura:** intro, zwrotki, przejścia (np. co 8 taktów fill perkusji), outro. Finał po zbiciu wszystkiego.

### Synteza (Web Audio, zero plików)

- **Perkusja:** stopa (sinus z opadającą częstotliwością), werbel (szum + ton), hi-hat (szum przez filtr górnoprzepustowy), klaśnięcie.
- **Bas:** piła przez filtr dolnoprzepustowy z obwiednią.
- **Pad:** kilka rozstrojonych pił, wolny atak, filtr.
- **Arpeggio i nuty klocków:** pluck (kwadrat/piła z krótką obwiednią filtra), dzwonek FM dla klocków specjalnych.
- **Miks:** szyna główna z kompresorem, wysyłka na pogłos (splot z generowanej odpowiedzi impulsowej) i echo, filtr główny (dla klocka „Filtr” w M3), `AnalyserNode` do tła reagującego na muzykę.
- Sidechain „pompowanie” padu i basu od stopy (automatyka gainu planowana razem ze stopą).

### Nagranie (M5)

Zapisujemy listę zdarzeń (czas, nuta, instrument, warstwy), a nie dźwięk. Odsłuchanie „swojej wersji” to ponowne odegranie zdarzeń przez ten sam syntezator.

---

## Klocki specjalne (M3)

| Klocek | Działanie |
|---|---|
| Akord | gra 3 nuty naraz (akord aktualnego taktu) |
| Perkusja | dodaje nową ścieżkę rytmu |
| Arpeggiator | odpala serię nut i rozbija sąsiednie klocki w rytmie (po szesnastce na klocek) |
| Filtr | zamyka i otwiera filtr całego miksu, słychać przejście |
| Echo | piłka na chwilę się klonuje, klony odbijają się jak echo i znikają |
| Metronom | zmienia tempo w górę albo w dół (płynnie, od następnego taktu) |
| Twardy | wymaga kilku trafień, każde brzmi wyżej (zrobiony już w M1) |
| Drop | zbicie wszystkich klocków tego typu uruchamia „drop” z wielkim efektem |

**Power-upy** (wypadają z niektórych klocków, łapane paletką): multiball, laser w paletce, szersza paletka, magnes, zwolnienie tempa.

---

## Plansza i kamera

- Świat w jednostkach, y w górę. Plansza ma stałe pionowe proporcje, renderer dopasowuje ją do ekranu (wysokość albo szerokość, co ciaśniejsze). Boki i nadmiar to tło.
- Na górze HUD (wynik, mnożnik, życia, pasek postępu utworu), na dole strefa palca pod paletką.
- Paletka jest nad dolną krawędzią planszy, a palec pod nią, więc palec jej nie zasłania.

---

## Sterowanie

- **Telefon:** przeciąganie w dowolnym miejscu (najwygodniej w dolnej części). Paletka podąża poziomo za palcem względnie (przesunięcie palca = przesunięcie paletki), z lekkim wygładzeniem. Szybki ruch w górę = uderzenie. Stuknięcie wystrzeliwuje piłkę.
- **Laptop:** mysz (paletka pod kursorem) albo strzałki. Spacja / klik / strzałka w górę = wystrzał i uderzenie. Esc = pauza.
- Blokada przewijania, zoomu i menu kontekstowego. Pauza przy utracie widoczności karty (muzyka też).

---

## Efekt wow (M2)

Wszystko proceduralne, surowy WebGL2, jak w Roju i Fali.

1. **Fale uderzeniowe:** pierścień zniekształcenia przestrzeni ekranu przy każdym trafieniu, mocniejszy przy trafieniach w rytm (kilka naraz, w composite).
2. **Aberracja chromatyczna** przy mocnych uderzeniach i dropach.
3. **Zamrożenie klatki** na ułamek sekundy przy idealnym trafieniu. Zegar muzyki nie staje, staje tylko symulacja (i potem ją dogania).
4. **Tło synthwave reaguje na muzykę:** neonowa siatka w perspektywie faluje z basem, słońce z pasami pulsuje ze stopą, gwiazdy migają z hi-hatem, góry na horyzoncie. Analiza częstotliwości z `AnalyserNode` plus zdarzenia z sekwencera (bardziej precyzyjne niż FFT dla bitu).
5. **Klocki:** szklane, neonowe bryły z rantem światła, które rozpadają się na świetliste odłamki w swoim kształcie i opadają.
6. **Piłka:** świetlisty ślad zmieniający kolor z rozgrzaniem.
7. **Kamera oddycha** z bitem (delikatny zoom na stopę).
8. **Postprocessing:** bloom, ACES, ziarno, scanlines (lekko, synthwave).

**Wydajność:** 60 fps na średnim telefonie, automatyczne obniżanie jakości (`quality`, jak w Roju).

---

## Technicznie

- **Repozytorium:** `~/code/puls`, origin poda właściciel. GitHub Pages z `dist/` (workflow z Fali).
- **Stack:** Vite, TypeScript, surowy WebGL2, Web Audio, PWA z service workerem. Kopiujemy z `~/code/fala` i `~/code/roj` (nie importujemy): RNG, `math.ts`, plugin SW, `icons.mjs`, workflow, później renderer z bloomem i composite.
- **Balans:** wszystkie liczby rozgrywki w `src/game/balance.ts` (`BAL`), w regułach żadnych zaszytych liczb. `#bal={...}` w URL nadpisuje.
- **Symulator:** `npm run sim` gra utwory bez grafiki botem o `skill` 0–1 (refleks paletki, trafianie uderzeniem w czasie). Raport: odsetek zaliczeń, zbite klocki do końca utworu, utracone piłki, trafienia w rytm. Cele pierwszego podejścia:
  - bot 0,5 zalicza pierwszy utwór zwykle, a zbija wszystko rzadko,
  - bot 0,9 zbija wszystko przed końcem utworu w większości gier,
  - bot 0,2 nie traci wszystkich żyć w pierwszej minucie.
- **Zapis:** `puls.meta.v1` (postęp, kalibracja, ustawienia), `puls.stats.v1`, `puls.hints.v1`, wszystko w `try/catch`.
- **Zasady z Roju:** kolory w shaderach liniowe; bez `pow` z ujemną podstawą; ziarnisty RNG w logice gry; ukryte ekrany nie łapią stuknięć.
- **Deploy:** po `git push` nie czekać na GitHub Actions.

---

## Kamienie milowe

**Po M1 STOP: test właściciela na telefonie.**

### M0: Szkielet
Repo, Vite + TS, WebGL2 z pustą sceną, PWA, ikony, workflow Pages, `CLAUDE.md`, ten plan.
**Odbiór:** `npm run build` przechodzi.

### M1: Czucie i rytm (grafika prosta)
- Plansza w kolumnie, paletka (palec względnie, mysz, strzałki), piłka, ściany, klocki, kąt odbicia zależny od miejsca trafienia.
- Sekwencer na zegarze audio, synteza perkusji, basu, padu, arpeggio i nut klocków, miks z pogłosem.
- Jeden utwór synthwave zaprojektowany jako melodia (rzędy = frazy), warstwy dokładane za zbite rzędy i zdejmowane za utratę piłki.
- Kwantyzacja nut do szesnastki.
- Piłka w rytmie (dopasowanie prędkości do bitu) i uderzenie z oknem idealne/dobre, mnożnik, rozgrzewanie piłki (z przebijaniem słabych klocków), stan „w rytmie”.
- Życia, koniec utworu / zbicie wszystkiego / utrata żyć, ekran końca, „jeszcze raz”.
- Kalibracja opóźnienia (stukanie w rytm + suwak), komunikat o iOS i wyciszeniu.
- Klocek **twardy** (kilka trafień, każde wyżej) przeniesiony z M3 do M1: bez niego plansza znikała w połowie utworu.
- Grafika: proste neonowe kształty w WebGL2 + minimalny bloom, pulsowanie tła ze stopą, prosta fala przy trafieniu (żeby feedback był czytelny).
- Symulator z botem.
- **Ustawienia testowe** w menu (jak w Fali): prędkość piłki, szerokość okna uderzenia, siła synchronizacji piłki (wyłączona / delikatna / pełna), sposób uderzenia na telefonie.

**Odbiór:** da się grać na telefonie i laptopie, muzyka nie rwie się, trafienia brzmią muzycznie, uderzenie w rytm jest czytelne i daje satysfakcję, symulator raportuje.

**STOP: test właściciela.**

### M2: Efekt wow
Tło synthwave reagujące na muzykę, szklane klocki i odłamki, ślad piłki, fale uderzeniowe w composite, aberracja, zamrożenie klatki, oddychająca kamera, obniżanie jakości.
**Odbiór:** zrzuty w pionie i poziomie, 60 fps w emulacji średniego telefonu, brak NaN.

### M3: Pełny poziom
Klocki specjalne, power-upy, HUD i menu docelowe, podpowiedzi przy pierwszej grze, pełna pętla poziomu.

### M4: MVP
5 utworów synthwave (rosnąca długość i liczba warstw), wybór utworu, odblokowywanie, gwiazdki, rekordy, zapis.
**Odbiór:** symulator spełnia cele, postęp przetrwa przeładowanie.

### M5: Szlif i dalej
Nagranie i odsłuch swojej wersji, utwór dnia, tryb Jam, kolejne albumy (Lo-fi, Chiptune, …), wydajność na słabszych telefonach, offline.

---

## Ryzyka i otwarte pytania

- **Opóźnienie dźwięku na telefonie**, zwłaszcza Bluetooth: kalibracja + szerokie okno uderzenia. Synchronizacja piłki do bitu pomaga, bo gracz może celować w piłkę, a nie w dźwięk.
- **Czy dopasowanie prędkości piłki będzie widać?** Jeśli tak, zawężamy zakres albo synchronizujemy do ósemek zamiast ćwierćnut.
- **Uderzenie ruchem palca w górę** może kolidować z przesuwaniem. Alternatywa do przetestowania: drugi palec / stuknięcie.
- **Melodie z klocków:** gracz zbija klocki w przypadkowej kolejności, więc fraza nie zabrzmi po kolei. Pomaga to, że nuty są ze skali i nad pasującym akordem; zobaczymy na teście, czy to wystarcza, czy np. klocki powinny grać „następną nutę frazy” zamiast własnej.
