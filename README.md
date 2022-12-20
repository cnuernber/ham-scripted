# Ham Scripted - High Perf JS Primitives


## Progress so far

Simple tests are at the bottom of the file.

#### Hashmaps

Implemented a bitmap trie hashmap and normal linear hashmap.
You can specialize these maps by passing in a hash provider to their constructors - tested out
different hash methods.

Turns out a really simple change in cljs.core/hash will speed it up in numerical cases by quite
a lot.


```clojure
  (dotimes [idx 10] (time (cljs.core/frequencies (eduction (map #(rem % 373373)) (range 1000000)))))
  ;;averages about 1250ms

  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn mut-map} (range 1000000))))
  ;;averages about 420ms
  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn java-hashmap} (range 1000000))))
  ;;averages about 130ms
```


## Development


```console
clj -M:cljs :node-repl

# Then cider-connect to localhost:8777
```

## License

MIT
