# Ham Scripted - High Perf JS Primitives


## Progress so far

Simple tests are at the bottom of the file.

#### Hashmaps

Implemented a bitmap trie hashmap and normal linear java-style hashmap.
You can specialize these maps by passing in a hash provider to their constructors - tested out
different hash methods.

Turns out a really simple change in cljs.core/hash will speed it up in numeric cases by quite
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


#### mean compared to kixi.stats.core/mean and reducers


Some perf was gained here by creating a bespoke js reducer and a very slight amount was gained
by having the range iteration reduction loop in js.  kixi's mean destructures and recreates
a vector every iteration of the reduction loop.

Kixi presents most of its functionaliy via reducers - functions with specific overloads for
initialization, reduction, and finalization.  This makes them awkward to use with Clojure's
default reduce pathway (although reductions.clj has a version of reduce that works correctly).

```clojure
cljs.user> (dotimes [idx 10]
                    (time (hamf/mean (hamf/range 100000))))
"Elapsed time: 1.527104 msecs"
"Elapsed time: 1.465767 msecs"
"Elapsed time: 1.465767 msecs"
;; (require '[kixi.stats.core :as k])
cljs.user> (dotimes [idx 10] (time (k/mean (reduce k/mean (k/mean) (cljs.core/range 100000)))))
"Elapsed time: 5.579152 msecs"
"Elapsed time: 5.699436 msecs"
"Elapsed time: 5.811123 msecs"
```

Hamf provides some sugar to make using things like kixi a lot more pleasant:

```clojure
cljs.user> (dotimes [idx 10]
             (time (hamf/reduce-reducer k/mean (hamf/range 100000))))
"Elapsed time: 5.036245 msecs"
"Elapsed time: 6.560798 msecs"
"Elapsed time: 5.327404 msecs"
```

So the next thing to try is what if we have a bespoke deftype - does that have the same
performance as the pure js object?


```clojure
cljs.user> (deftype RMean [^:unsynchronized-mutable s
                           ^:unsynchronized-mutable n]
             Object
             (accept [this v] (set! n (+ n 1))
               (set! s (+ s v)))
             (deref [this] (/ s n)))
cljs.user/RMean
cljs.user> (hamf/reduce-reducer (hamf/consumer-reducer #(RMean. 0 0))
                                (hamf/range 100000))
49999.5
cljs.user> (dotimes [idx 10]
             (time (hamf/reduce-reducer (hamf/consumer-reducer #(RMean. 0 0))
                                        (hamf/range 100000))))
"Elapsed time: 1.630005 msecs"
"Elapsed time: 1.535182 msecs"
"Elapsed time: 1.520164 msecs"
```

The answer is yes, precisely the same timings - ClojureScript's default deftype and
code generation, unlike Clojure's, is - for this case - equally performant as a
hand-written pure-js pathway.

Finally, any reducer can be used as a reducer in group-by-reducer:

```clojure
cljs.user> (hamf/group-by #(rem % 13) (range 200))
{0 [0 13 26 39 52 65 78 91 104 117 130 143 156 169 182 195],
 7 [7 20 33 46 59 72 85 98 111 124 137 150 163 176 189],
 1 [1 14 27 40 53 66 79 92 105 118 131 144 157 170 183 196],
 4 [4 17 30 43 56 69 82 95 108 121 134 147 160 173 186 199],
 6 [6 19 32 45 58 71 84 97 110 123 136 149 162 175 188],
 3 [3 16 29 42 55 68 81 94 107 120 133 146 159 172 185 198],
 12 [12 25 38 51 64 77 90 103 116 129 142 155 168 181 194],
 2 [2 15 28 41 54 67 80 93 106 119 132 145 158 171 184 197],
 11 [11 24 37 50 63 76 89 102 115 128 141 154 167 180 193],
 9 [9 22 35 48 61 74 87 100 113 126 139 152 165 178 191],
 5 [5 18 31 44 57 70 83 96 109 122 135 148 161 174 187],
 10 [10 23 36 49 62 75 88 101 114 127 140 153 166 179 192],
 8 [8 21 34 47 60 73 86 99 112 125 138 151 164 177 190]}
cljs.user> (hamf/group-by-reducer #(rem % 13) k/mean (range 200))
{0 97.5,
 7 98,
 1 98.5,
 4 101.5,
 6 97,
 3 100.5,
 12 103,
 2 99.5,
 11 102,
 9 100,
 5 96,
 10 101,
 8 99}
```

(there is an interesting pattern there if you sort by first)

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

But the Clojure pathway never hits the fragile fastpath - in this case I think
because PersistentVector's reduce is called in order to load the namespace itself so
there is never a single-function callsite of reduce.

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


The simple work around is, if like in reduce you are going to repeatedly call a function
of known arity from js is to lookup the statically defined version:

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
