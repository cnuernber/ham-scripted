# Ham Scripted - High Perf JS Primitives


## Progress so far

Simple tests are at the bottom of the file.

#### Hashmaps

Implemented a bitmap trie hashmap and normal linear java-style hashmap.
You can specialize these maps by passing in a hash provider to their constructors - tested out
different hash methods.

Turns out a really simple change in cljs.core/hash will speed it up in numerical cases by quite
a lot - put the numeric case above the generic protocol dispatch.  This has zero detrimental
effect to other cases but does speed up numeric cases by about 5x.


You can emulate both function assoc and transient assoc by using `shallowClone` -

* function assoc - `(fn [m k v] (-> (.shallowClone ^JS m) (.mutAssoc k v)))`
* transient assoc reduction - `(reduce (fn [m [k v]] (.mutAssoc ^JS m k v)) (.shallowClone m) data)`




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
clj -M:cljs node-repl

# Then cider-connect to localhost:8777


cljs.user=>
shadow.user> (shadow/repl :node-repl)
shadow-cljs - #4 ready!
To quit, type: :cljs/quit
```

## License

MIT
