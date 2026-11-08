Il file italian.dic.fc è il dizionario compresso (3.009.116 parole italiane, licenza Unlicense: vedi LICENSE.md).
Per espanderlo in un file di testo, dalla cartella data/dizionari/italian-dictionary:
  LANG=C.UTF-8 ruby -E UTF-8:UTF-8 dictionary-expand.rb italian.dic.fc
Crea italian.dic nella stessa cartella (non è incluso nel repo perché pesa circa 43 MB).
