import {Node, Mark, Schema} from "prosemirror-model"

import {Selection, TextSelection} from "./selection"
import {Transaction} from "./transaction"
import {Plugin, StateField} from "./plugin"

function bind<T extends Function>(f: T, self: any): T {
  return !self || !f ? f : f.bind(self)
}

class FieldDesc<T> {
  init: (config: EditorStateConfig, instance: EditorState) => T
  apply: (tr: Transaction, value: T, oldState: EditorState, newState: EditorState) => T

  constructor(readonly name: string, desc: StateField<any>, self?: any) {
    this.init = bind(desc.init, self)
    this.apply = bind(desc.apply, self)
  }
}

const baseFields = [
  new FieldDesc<Node>("doc", {
    init(config) { return config.doc || config.schema!.topNodeType.createAndFill() },
    apply(tr) { return tr.doc }
  }),

  new FieldDesc<Selection>("selection", {
    init(config, instance) { return config.selection || Selection.atStart(instance.doc) },
    apply(tr) { return tr.selection }
  }),

  new FieldDesc<readonly Mark[] | null>("storedMarks", {
    init(config) { return config.storedMarks || null },
    apply(tr, _marks, _old, state) { return (state.selection as TextSelection).$cursor ? tr.storedMarks : null }
  }),

  new FieldDesc<number>("scrollToSelection", {
    init() { return 0 },
    apply(tr, prev) { return tr.scrolledIntoView ? prev + 1 : prev }
  })
]

// Object wrapping the part of a state object that stays the same
// across transactions. Stored in the state's `config` property.
class Configuration {
  fields: FieldDesc<any>[]
  plugins: Plugin[] = []
  pluginsByKey: {[key: string]: Plugin} = Object.create(null)

  constructor(readonly schema: Schema, plugins?: readonly Plugin[]) {
    this.fields = baseFields.slice()
    if (plugins) plugins.forEach(plugin => {
      if (this.pluginsByKey[plugin.key])
        throw new RangeError("Adding different instances of a keyed plugin (" + plugin.key + ")")
      this.plugins.push(plugin)
      this.pluginsByKey[plugin.key] = plugin
      if (plugin.spec.state)
        this.fields.push(new FieldDesc<any>(plugin.key, plugin.spec.state, plugin))
    })
  }
}

/// The type of object passed to
/// [`EditorState.create`](#state.EditorState^create).
///
/// @cn [`EditorState.create`](#state.EditorState^create).方法的参数接口
export interface EditorStateConfig {
  /// The schema to use (only relevant if no `doc` is specified).
  ///
  /// @cn 定义好的 schema（仅在未指定doc时相关）。
  ///
  /// @comment 如果传入了 doc, 就直接从 doc 对象上获取 schema 了
  schema?: Schema

  /// The starting document. Either this or `schema` _must_ be
  /// provided.
  ///
  /// @cn 初始的 doc。doc 或 schema _必须_提供一个
  doc?: Node

  /// A valid selection in the document.
  ///
  /// @cn 文档中可用的选区。
  selection?: Selection

  /// The initial set of [stored marks](#state.EditorState.storedMarks).
  ///
  /// @cn [stored marks](#state.EditorState.storedMarks) 的初始集合。
  storedMarks?: readonly Mark[] | null

  /// The plugins that should be active in this state.
  ///
  /// @cn state 中激活的 plugins。
  plugins?: readonly Plugin[]
}

/// The state of a ProseMirror editor is represented by an object of
/// this type. A state is a persistent data structure—it isn't
/// updated, but rather a new state value is computed from an old one
/// using the [`apply`](#state.EditorState.apply) method.
///
///@cn ProseMirror 编辑器状态由此对象表示。一个 state 是一个持久化的数据结构--它本身并不更新，旧的 state 通过 [`apply`](#state.EditorState.apply) 方法产生一个新的 state。
///
/// A state holds a number of built-in fields, and plugins can
/// [define](#state.PluginSpec.state) additional fields.
///
/// @cn 一个 state 有很多内建的字段，同时可以通过 plugins 来 [定义](#state.PluginSpec.state) 额外的字段。
export class EditorState {
  /// @internal
  constructor(
    /// @internal
    readonly config: Configuration
  ) {}

  /// The current document.
  ///
  /// @cn 当前文档
  doc!: Node

  /// The selection.
  ///
  /// @cn 当前选区。
  selection!: Selection

  /// A set of marks to apply to the next input. Will be null when
  /// no explicit marks have been set.
  ///
  /// @cn 即将要应用到下一次输入的 marks。如果没有显式的设置 marks，此字段将会是 null。
  storedMarks!: readonly Mark[] | null

  /// The schema of the state's document.
  ///
  /// @cn state 所表示的文档的 schema。
  get schema(): Schema {
    return this.config.schema
  }

  /// The plugins that are active in this state.
  ///
  /// @cn 在当前 state 中激活的 plugins。
  get plugins(): readonly Plugin[] {
    return this.config.plugins
  }

  /// Apply the given transaction to produce a new state.
  ///
  /// @cn 对旧的 state 应用给定的 transaction 以产生一个新的 state。
  apply(tr: Transaction): EditorState {
    return this.applyTransaction(tr).state
  }

  /// @internal
  filterTransaction(tr: Transaction, ignore = -1) {
    for (let i = 0; i < this.config.plugins.length; i++) if (i != ignore) {
      let plugin = this.config.plugins[i]
      if (plugin.spec.filterTransaction && !plugin.spec.filterTransaction.call(plugin, tr, this))
        return false
    }
    return true
  }

  /// Verbose variant of [`apply`](#state.EditorState.apply) that
  /// returns the precise transactions that were applied (which might
  /// be influenced by the [transaction
  /// hooks](#state.PluginSpec.filterTransaction) of
  /// plugins) along with the new state.
  ///
  /// @cn [`apply`](#state.EditorState.apply) 的复杂版。该接口返回将应用到旧 state 以产生新 state 的每一个 transactions
  /// （其返回解构可能被插件的 [transaction hooks](#state.PluginSpec.filterTransaction) 影响。）
  applyTransaction(rootTr: Transaction): {state: EditorState, transactions: readonly Transaction[]} {
    if (!this.filterTransaction(rootTr)) return {state: this, transactions: []}

    let trs = [rootTr], newState = this.applyInner(rootTr), seen = null
    // This loop repeatedly gives plugins a chance to respond to
    // transactions as new transactions are added, making sure to only
    // pass the transactions the plugin did not see before.
    for (;;) {
      let haveNew = false
      for (let i = 0; i < this.config.plugins.length; i++) {
        let plugin = this.config.plugins[i]
        if (plugin.spec.appendTransaction) {
          let n = seen ? seen[i].n : 0, oldState = seen ? seen[i].state : this
          let tr = n < trs.length &&
              plugin.spec.appendTransaction.call(plugin, n ? trs.slice(n) : trs, oldState, newState)
          if (tr && newState.filterTransaction(tr, i)) {
            tr.setMeta("appendedTransaction", rootTr)
            if (!seen) {
              seen = []
              for (let j = 0; j < this.config.plugins.length; j++)
                seen.push(j < i ? {state: newState, n: trs.length} : {state: this, n: 0})
            }
            trs.push(tr)
            newState = newState.applyInner(tr)
            haveNew = true
          }
          if (seen) seen[i] = {state: newState, n: trs.length}
        }
      }
      if (!haveNew) return {state: newState, transactions: trs}
    }
  }

  /// @internal
  applyInner(tr: Transaction) {
    if (!tr.before.eq(this.doc)) throw new RangeError("Applying a mismatched transaction")
    let newInstance = new EditorState(this.config), fields = this.config.fields
    for (let i = 0; i < fields.length; i++) {
      let field = fields[i]
      ;(newInstance as any)[field.name] = field.apply(tr, (this as any)[field.name], this, newInstance)
    }
    return newInstance
  }

  /// Start a [transaction](#state.Transaction) from this state.
  ///
  /// @cn 从当前 state 生成一个新的 [transaction](#state.Transaction) 以对当前 state 进行修改。
  ///
  /// @comment 该 transaction 是一个 getter 函数，每次调用都会 new 一个新的 transaction。
  get tr(): Transaction { return new Transaction(this) }

  /// Create a new state.
  ///
  /// @cn 创建一个新的 state。
  static create(config: EditorStateConfig) {
    let $config = new Configuration(config.doc ? config.doc.type.schema : config.schema!, config.plugins)
    let instance = new EditorState($config)
    for (let i = 0; i < $config.fields.length; i++)
      (instance as any)[$config.fields[i].name] = $config.fields[i].init(config, instance)
    return instance
  }

  /// Create a new state based on this one, but with an adjusted set
  /// of active plugins. State fields that exist in both sets of
  /// plugins are kept unchanged. Those that no longer exist are
  /// dropped, and those that are new are initialized using their
  /// [`init`](#state.StateField.init) method, passing in the new
  /// configuration object..
  ///
  /// @cn 基于当前的 state 新建一个新的 state，只是新的 state 的中的字段会由传入的 plugins 重新配置。新旧两组 plugins 中的 state 字段中都存在的字段保持不变。
  /// （相比于旧的 plugins 中）不再存在的字段将会被丢弃，新增的字段将会使用 plugin 的 state 对象的 [`init`](#state.StateField.init) 方法进行初始化后作为新的 state 字段。
  ///
  /// @comment plugin 配置对象有一个 state 字段，其有两个方法，一个是 init 用来初始化 state；一个是 apply，用来决定如何更新 state。此 create 方法对于新增的 plugin 会调用其 state 的 init 方法进行初始化，以生成编辑器的 state。
  reconfigure(config: {
    /// New set of active plugins.
    ///
    ///@cn 新的激活的插件集合。
    ///
    ///@comment plugins 上的 state 构成新的编辑器的 state。
    plugins?: readonly Plugin[]    
  }) {
    let $config = new Configuration(this.schema, config.plugins)
    let fields = $config.fields, instance = new EditorState($config)
    for (let i = 0; i < fields.length; i++) {
      let name = fields[i].name
      ;(instance as any)[name] = this.hasOwnProperty(name) ? (this as any)[name] : fields[i].init(config, instance)
    }
    return instance
  }

  /// Serialize this state to JSON. If you want to serialize the state
  /// of plugins, pass an object mapping property names to use in the
  /// resulting JSON object to plugin objects. The argument may also be
  /// a string or number, in which case it is ignored, to support the
  /// way `JSON.stringify` calls `toString` methods.
  ///
  /// @cn 将 state 对象序列化成 JSON 对象。如果你想序列化 plugin 的 state，则需要传递一个有着属性名-插件的映射关系的对象，该对象的属性名就会出现在返回值结果对象中。
  /// 参数也可以是字符串或者数字，但这种情况下参数会被忽略，以支持以 `JSON.stringify` 的方式调用 `toString` 方法。
  ///
  /// @comment 如果想序列化 plugin 的 state，需要 plugin 的 state 对象有提供 toJSON 方法，该方法的参数是 plugin 的 key。`doc` 和 `selection` 是保留字段，不能作为参数对象的属性名。
  toJSON(pluginFields?: {[propName: string]: Plugin}): any {
    let result: any = {doc: this.doc.toJSON(), selection: this.selection.toJSON()}
    if (this.storedMarks) result.storedMarks = this.storedMarks.map(m => m.toJSON())
    if (pluginFields && typeof pluginFields == 'object') for (let prop in pluginFields) {
      if (prop == "doc" || prop == "selection")
        throw new RangeError("The JSON fields `doc` and `selection` are reserved")
      let plugin = pluginFields[prop], state = plugin.spec.state
      if (state && state.toJSON) result[prop] = state.toJSON.call(plugin, (this as any)[plugin.key])
    }
    return result
  }

  /// Deserialize a JSON representation of a state. `config` should
  /// have at least a `schema` field, and should contain array of
  /// plugins to initialize the state with. `pluginFields` can be used
  /// to deserialize the state of plugins, by associating plugin
  /// instances with the property names they use in the JSON object.
  ///
  /// @cn 反序列化一个 state 的 JSON 表示。`config` 至少应该有一个 `schema` 字段，并且应该包含用来初始化 state 的 plugin 数组。
  /// `pluginField` 参数通过在 JSON 对象中的属性名与 plugin 实例对应的方式来反序列化 plugin 的 state。
  ///
  /// @comment `pluginFields` 中的属性名如果对应到了某个 plugin 的 key（string），则会调用对应 plugin 的 state 的 fromJSON 方法，
  // 如果没有对应到任一个 plugin 的 key，则会直接调 plugin 的 state 的 init 方法，前者参数是 config、插件对应的 json 和根据 config 生成的编辑器 state；后者参数是 config 和根据 config 生成的编辑器的 state。
  ///
  static fromJSON(config: {
    /// The schema to use.
    ///
    /// @cn 反序列化用到的 schema。
    schema: Schema
    /// The set of active plugins.
    ///
    /// @cn 激活插件的集合。
    plugins?: readonly Plugin[]
  }, json: any, pluginFields?: {[propName: string]: Plugin}) {
    if (!json) throw new RangeError("Invalid input for EditorState.fromJSON")
    if (!config.schema) throw new RangeError("Required config field 'schema' missing")
    let $config = new Configuration(config.schema, config.plugins)
    let instance = new EditorState($config)
    $config.fields.forEach(field => {
      if (field.name == "doc") {
        instance.doc = Node.fromJSON(config.schema, json.doc)
      } else if (field.name == "selection") {
        instance.selection = Selection.fromJSON(instance.doc, json.selection)
      } else if (field.name == "storedMarks") {
        if (json.storedMarks) instance.storedMarks = json.storedMarks.map(config.schema.markFromJSON)
      } else {
        if (pluginFields) for (let prop in pluginFields) {
          let plugin = pluginFields[prop], state = plugin.spec.state
          if (plugin.key == field.name && state && state.fromJSON &&
              Object.prototype.hasOwnProperty.call(json, prop)) {
            // This field belongs to a plugin mapped to a JSON field, read it from there.
            ;(instance as any)[field.name] = state.fromJSON.call(plugin, config, json[prop], instance)
            return
          }
        }
        ;(instance as any)[field.name] = field.init(config, instance)
      }
    })
    return instance
  }
}
