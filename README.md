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

#### group-by-reducer

Perform a reduction during a group-by.  Takes a transducer-compatible reducer.


```clojure

ham-scripted.api> (dotimes [idx 10]
                    (time (group-by-reducer #(rem % 3733) + (range 100000))))

"Elapsed time: 10.176957 msecs"
"Elapsed time: 9.623497 msecs"
"Elapsed time: 12.023776 msecs"
nil

(defn group-by-reducer-cljs
  [key-fn reducer coll]
  (->> (group-by key-fn coll)
       (into {} (map (fn [[k v]] [k (-> (reduce reducer (reducer) v)
                                        (reducer))])))))


ham-scripted.api> (dotimes [idx 10]
                    (time (group-by-reducer-cljs #(rem % 3733) + (cljs.core/range 100000))))
"Elapsed time: 118.711570 msecs"
"Elapsed time: 119.257793 msecs"
"Elapsed time: 124.406629 msecs"
nil
```


#### mean compared to kixi.stats.core/mean


```clojure
ham-scripted.api> (dotimes [idx 10]
                    (time (mean (cljs.core/range 100000))))
"Elapsed time: 1.832255 msecs"
"Elapsed time: 1.740176 msecs"
"Elapsed time: 1.855512 msecs"
;; ham-scripted has a faster range object
ham-scripted.api> (dotimes [idx 10]
                    (time (mean (range 100000))))
"Elapsed time: 1.066491 msecs"
"Elapsed time: 1.059102 msecs"
"Elapsed time: 1.040609 msecs"
;; (require '[kixi.stats.core :as k])
ham-scripted.api> (dotimes [idx 10]
                    (time (k/mean (reduce k/mean (k/mean) (cljs.core/range 100000)))))
"Elapsed time: 15.579152 msecs"
"Elapsed time: 14.381574 msecs"
"Elapsed time: 15.699436 msecs"
```


#### Clojure Variadic Functions from Javascript

There is a pretty heavy penality for using at variadic cljs functions from js in a tight loop
with a fixed arity - for instance if we implement reduce in javascript.

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
appears to 'remember' that more than one function method was used here and backs off to
an intermediate optimization level:

```clojure
ham-scripted.api> (dotimes [idx 10]
                    (time (.reduce m js-add 0)))
...
"Elapsed time: 1.276535 msecs"
"Elapsed time: 1.357354 msecs"
"Elapsed time: 1.731493 msecs"
```

Interestingly enough, this penalty doesn't exist from Clojure itself -

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
After a restart - in this case I think because PersistentVector's reduce is called
in order to load the namespace itself so there is never a single-function callsite
of reduce:


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


The simple work around is, if like in reduce you are going to repeatedly call a function
of known arity is to lookup the statically defined version:

```clojure
function twoArgInvoker(rfn) {
    return rfn.cljs$core$IFn$_invoke$arity$2 ?
	rfn.cljs$core$IFn$_invoke$arity$2 : rfn;
}
```


This makes the Clojure vararg function with a 2 arg arity perform exactly the same
as a pure-js function in a tight reduction from javascript.



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
