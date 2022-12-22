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


You can emulate both functional assoc and transient assoc! by using `shallowClone` -

* functional assoc - `(fn [m k v] (-> (.shallowClone ^JS m) (.mutAssoc k v)))`
* transient assoc! reduction - `(reduce (fn [m [k v]] (.mutAssoc ^JS m k v)) (.shallowClone m) data)`




```clojure
  (dotimes [idx 10] (time (cljs.core/frequencies (eduction (map #(rem % 373373)) (range 1000000)))))
  ;;averages about 1250ms

  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn mut-map} (range 1000000))))
  ;;averages about 420ms
  (dotimes [idx 10] (time (frequencies (map #(rem % 373373)) {:map-fn java-hashmap} (range 1000000))))
  ;;averages about 130ms
```


#### Iteresting Findings

These findings so far are likely Node/V8 specific -

There is a pretty heavy penality for using at variadic cljs functions during reductions -

 ```clojure
ham-scripted.api> (def m (mut-list (range 100000)))
#'ham-scripted.api/m
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m js-add 0)))
...
"Elapsed time: 0.275752 msecs"
"Elapsed time: 0.368628 msecs"
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m + 0)))
...
"Elapsed time: 6.119186 msecs"
"Elapsed time: 6.293762 msecs"
nil
 ```

That penalty doesn't go away after you have used the cljs method - the reduce callsite
appears to 'remember' that a not-true-js method was used here:

```clojure
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m js-add 0)))
...
"Elapsed time: 1.276535 msecs"
"Elapsed time: 1.357354 msecs"
"Elapsed time: 1.731493 msecs"
```

There is also a penalty if you use a *different* pure-js method.  Then the optimizations
back off to the last case above.  So if I have defined a pure js method, js-sub,
and I do a reduce with js-sub and then js-add the timings will be about 1.3ms or so --
*not* 0.2ms or so.


Recompiling the namespace resets the optimization pathway, the reduction with a pure
js add or subtract pathway will have the top performance falling off apparently permanently
to the second tier if a second js method is used.


```clojure

ham-scripted.api> (def m (mut-list (range 100000)))
#'ham-scripted.api/m
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m (aget cv-module "addVal") 0)))
"Elapsed time: 0.286648 msecs"
"Elapsed time: 0.286395 msecs"
"Elapsed time: 0.285851 msecs"
nil

ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m (aget cv-module "decVal") 0)))
...
"Elapsed time: 2.230094 msecs"
"Elapsed time: 1.950038 msecs"
"Elapsed time: 1.376309 msecs"
nil
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m (aget cv-module "addVal") 0)))
...
"Elapsed time: 2.520038 msecs"
"Elapsed time: 1.942071 msecs"
"Elapsed time: 2.385680 msecs"
nil

ham-scripted.api> (def js-add (aget cv-module "addVal"))
#'ham-scripted.api/js-add
ham-scripted.api> js-add
#object[Function]
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m (fn [a b](js-add a b)) 0)))
...
"Elapsed time: 2.942858 msecs"
"Elapsed time: 2.331446 msecs"
"Elapsed time: 2.718734 msecs"
nil
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m (fn [a b](+ a b)) 0)))
...
"Elapsed time: 2.815240 msecs"
"Elapsed time: 2.119683 msecs"
"Elapsed time: 2.691423 msecs"
nil
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m + 0)))
...
"Elapsed time: 7.024980 msecs"
"Elapsed time: 6.695283 msecs"
"Elapsed time: 6.730351 msecs"
```

This penalty isn't there from Clojure, however:

```clojure

ham-scripted.api> (def v (vec (range 100000)))
#'ham-scripted.api/v
ham-scripted.api> (dotimes [idx 10]
                    (time (reduce + 0 v)))
...
"Elapsed time: 3.571963 msecs"
"Elapsed time: 1.928614 msecs"
"Elapsed time: 2.299809 msecs"
nil
ham-scripted.api> (dotimes [idx 10]
                    (time (reduce js-add 0 v)))
...
"Elapsed time: 2.096214 msecs"
"Elapsed time: 2.241566 msecs"
"Elapsed time: 2.870960 msecs"
nil
```

But the Clojure pathway never hits the fragile fastpath.
After a restart:

```clojure
ham-scripted.api> (def v (vec (range 100000)))
#'ham-scripted.api/v
ham-scripted.api> (dotimes [idx 10]
                    (time (reduce + 0 v)))
...
"Elapsed time: 3.571963 msecs"
"Elapsed time: 1.928614 msecs"
"Elapsed time: 2.299809 msecs"
nil
ham-scripted.api> (dotimes [idx 10]
                    (time (reduce js-add 0 v)))
...
"Elapsed time: 2.096214 msecs"
"Elapsed time: 2.241566 msecs"
"Elapsed time: 2.870960 msecs"
nil
ham-scripted.api> (def v (vec (range 100000)))
#'ham-scripted.api/v
ham-scripted.api> (def js-add (aget cv-module "addVal"))
#'ham-scripted.api/js-add
ham-scripted.api> (dotimes [idx 10]
                    (time (reduce js-add 0 v)))
...
"Elapsed time: 2.241189 msecs"
"Elapsed time: 2.673577 msecs"
"Elapsed time: 2.263259 msecs"
nil
ham-scripted.api> (def m (mut-list (range 100000)))
#'ham-scripted.api/m
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m js-add 0)))
...
"Elapsed time: 0.247272 msecs"
"Elapsed time: 0.247015 msecs"
"Elapsed time: 0.246565 msecs"
nil
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
