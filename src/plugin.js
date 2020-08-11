// PluginSpec:: interface
//
// This is the type passed to the [`Plugin`](#state.Plugin)
// constructor. It provides a definition for a plugin.
//
//  @cn 这是一个传递给 [`Plugin`](#state.Plugin) 构造函数的类型。它提供了插件的配置。
//
//   props:: ?EditorProps
//   The [view props](#view.EditorProps) added by this plugin. Props
//   that are functions will be bound to have the plugin instance as
//   their `this` binding.
//
//   @cn 该插件设置的 [视图属性](#view.EditorProps)。属性如果是函数，则函数的 `this` 将绑定到当前实例。
//
//   @comment 对象属性是函数的话一般叫做对象的方法。
//
//   state:: ?StateField<any>
//   Allows a plugin to define a [state field](#state.StateField), an
//   extra slot in the state object in which it can keep its own data.
//
//   @cn 允许插件定义一个 [state 字段](#state.StateField)，一个在编辑器整体 state 对象上的额外的插槽，其可以持有自己的插件 state。
//
//   key:: ?PluginKey
//   Can be used to make this a keyed plugin. You can have only one
//   plugin with a given key in a given state, but it is possible to
//   access the plugin's configuration and state through the key,
//   without having access to the plugin instance object.
//
//   @cn 可以被用来唯一确定一个 plugin。在一个给定的 state 你只能有一个给定 key 的 plugin。
//   你可以通过这个 key 而不用访问插件实例来访问该插件的配置和 state。
//
//   view:: ?(EditorView) → Object
//   When the plugin needs to interact with the editor view, or
//   set something up in the DOM, use this field. The function
//   will be called when the plugin's state is associated with an
//   editor view.
//
//   @cn 当插件需要与编辑器视图交互的时候，或者需要在 DOM 上设置一些东西的时候，使用这个字段。
//   当插件的 state 与编辑器 view 有关联的时候将会调用该函数。
//
//     return::-
//     Should return an object with the following optional
//     properties:
//
//     @cn 应该返回有下列可选属性的对象：
//
//       update:: ?(view: EditorView, prevState: EditorState)
//       Called whenever the view's state is updated.
//
//       @cn 编辑器 view 一更新就调用该函数。
//
//       @comment 编辑器 view 更新可能是用户的操作如输入内容，或者编辑器的操作，如由事件触发的 transaction 更新视图，
//       此处可以拿到编辑器的 view 和应用 transaction 之前的 state。
//
//       destroy:: ?()
//       Called when the view is destroyed or receives a state
//       with different plugins.
//
//       @cn 当 state 对象被重新配置而不再含该插件或者编辑器视图被销毁的时候调用该函数。
//
//       @comment 页面重载等情况会销毁编辑器的 view。
//
//   filterTransaction:: ?(Transaction, EditorState) → bool
//   When present, this will be called before a transaction is
//   applied by the state, allowing the plugin to cancel it (by
//   returning false).
//
//   @cn 如果有该函数，则该函数会在一个 transaction 被应用到 state 之前调用，以允许插件有机会取消该 transaction（通过返回 false）
//
//   appendTransaction:: ?(transactions: [Transaction], oldState: EditorState, newState: EditorState) → ?Transaction
//   Allows the plugin to append another transaction to be applied
//   after the given array of transactions. When another plugin
//   appends a transaction after this was called, it is called again
//   with the new state and new transactions—but only the new
//   transactions, i.e. it won't be passed transactions that it
//   already saw.
//
//   @cn 允许这个插件附加另一个 transaction 到将要被应用的 transactions 数组的末尾上去。
//   当另一个 plugin 又附加了一个 transaction 且其在当前 plugin 之后调用，
//   则当前 plugin 的该函数会再调用一次。但是仅含新的 transaction 和新的 state。也即是，它不会再将之前处理过的 transaction 再处理一次。

function bindProps(obj, self, target) {
  for (let prop in obj) {
    let val = obj[prop]
    if (val instanceof Function) val = val.bind(self)
    else if (prop == "handleDOMEvents") val = bindProps(val, self, {})
    target[prop] = val
  }
  return target
}

// ::- Plugins bundle functionality that can be added to an editor.
// They are part of the [editor state](#state.EditorState) and
// may influence that state and the view that contains it.
//
// @cn Plugins 可以被添加到 editor 中，它们是 [编辑器 state](#state.EditorState) 的一部分，并且能够影响包含它的 state 和 view。
export class Plugin {
  // :: (PluginSpec)
  // Create a plugin.
  //
  // @cn 创建一个 plugin。
  constructor(spec) {
    // :: EditorProps
    // The [props](#view.EditorProps) exported by this plugin.
    //
    // @cn 当前插件导出的 [属性](#view.EditorProps)
    this.props = {}
    if (spec.props) bindProps(spec.props, this, this.props)
    // :: Object
    // The plugin's [spec object](#state.PluginSpec).
    //
    // @cn 当前插件的 [配置对象](#state.PluginSpec)。
    this.spec = spec
    this.key = spec.key ? spec.key.key : createKey("plugin")
  }

  // :: (EditorState) → any
  // Extract the plugin's state field from an editor state.
  //
  // @cn 从编辑器的 state 上获取当前插件的 state。
  getState(state) { return state[this.key] }
}

// StateField:: interface<T>
// A plugin spec may provide a state field (under its
// [`state`](#state.PluginSpec.state) property) of this type, which
// describes the state it wants to keep. Functions provided here are
// always called with the plugin instance as their `this` binding.
//
// @cn 插件可能会提供一个该配置类型的 state 字段（在它的 [`state`](#state.PluginSpec.state) 属性上）。
// 它描述了插件想要持有的 state。该字段下的方法调用的时候，其 `this` 指向插件实例。
//
//   init:: (config: Object, instance: EditorState) → T
//   Initialize the value of the field. `config` will be the object
//   passed to [`EditorState.create`](#state.EditorState^create). Note
//   that `instance` is a half-initialized state instance, and will
//   not have values for plugin fields initialized after this one.
//
//   @cn 初始化插件的 state。`config` 是传递给 [`EditorState.create`](#state.EditorState^create) 的对象。
//   记住：`instance` 是一个半初始化的 state 实例，在当前插件之后初始化的插件在此时将不会有值。
//
//   @comment 因此在新建 state 的时候，插件的顺序至关重要。
//
//   apply:: (tr: Transaction, value: T, oldState: EditorState, newState: EditorState) → T
//   Apply the given transaction to this state field, producing a new
//   field value. Note that the `newState` argument is again a partially
//   constructed state does not yet contain the state from plugins
//   coming after this one.
//
//   @cn 应用给定的 transaction 到插件的 state 字段，以产生一个新的 state。
//   记住，`newState` 参数再一次的，是一个部分构造的 state，它不会包含当前插件之后还未初始化的插件的 state。
//
//   toJSON:: ?(value: T) → *
//   Convert this field to JSON. Optional, can be left off to disable
//   JSON serialization for the field.
//
//   @cn 将当前字段值转换成 JSON。当然，你也可以留空以禁用当前插件 state 的序列化。
//
//   @comment 所谓转成 JSON，在该文档所有对象的 toJSON 方法都是转成一个 plain object，而不是 JSON.stringify 得到的对象。
//
//   fromJSON:: ?(config: Object, value: *, state: EditorState) → T
//   Deserialize the JSON representation of this field. Note that the
//   `state` argument is again a half-initialized state.
//
//   @cn 反序列化给定的该字段的 JSON 表示对象。记住：`state` 参数还是一个半序列化的 state 对象。

const keys = Object.create(null)

function createKey(name) {
  if (name in keys) return name + "$" + ++keys[name]
  keys[name] = 0
  return name + "$"
}

// ::- A key is used to [tag][tag](#state.PluginSpec.key)
// plugins in a way that makes it possible to find them, given an
// editor state. Assigning a key does mean only one plugin of that
// type can be active in a state.
//
// @cn 一个插件 key 用来 [标记][tag](#state.PluginSpec.key) 一个插件，以能够在通过搜索编辑器的 state 来方便的找到它。
export class PluginKey {
  // :: (?string)
  // Create a plugin key.
  //
  // @cn 新建一个 plugin key
  constructor(name = "key") { this.key = createKey(name) }

  // :: (EditorState) → ?Plugin
  // Get the active plugin with this key, if any, from an editor
  // state.
  //
  // @cn 用 key 从 state 获取到 key 对应的激活的插件。
  get(state) { return state.config.pluginsByKey[this.key] }

  // :: (EditorState) → ?any
  // Get the plugin's state from an editor state.
  //
  // @cn 从编辑器的 state 中获取插件的 state。
  getState(state) { return state[this.key] }
}
