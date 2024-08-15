import {Transform, Step} from "prosemirror-transform"
import {Mark, MarkType, Node, Slice} from "prosemirror-model"
import {type EditorView} from "prosemirror-view"
import {Selection} from "./selection"
import {Plugin, PluginKey} from "./plugin"
import {EditorState} from "./state"

/// Commands are functions that take a state and a an optional
/// transaction dispatch function and...
///
/// @cn Commands 是一种函数，它接受一个 state 参数和一个可选的事务调度函数 dispatch
///
///  - determine whether they apply to this state
///  - if not, return false
///  - if `dispatch` was passed, perform their effect, possibly by
///    passing a transaction to `dispatch`
///  - return true
///
/// @cn - 判断它们是否适用于这个状态
/// - 如果不适用,就返回 false
/// - 如果传递了 dispatch，则执行它们的效果，可能通过将 tr 传递给 dispatch 来实现, 并且此时 Command 返回 True
///
/// In some cases, the editor view is passed as a third argument.
///
/// @cn 在某些情况下, editor view 可能作为第三个参数被传递给 Command
///
/// @comment Command 函数通常作为一种菜单工具栏绑定或者按键绑定的函数, dispatch 不传的情况通常出现在检测指定的效果能否被应用到当前的 editor state.
/// 举个例子就是 工具栏有个 粗体 按钮,此时光标聚焦在 codeblock 上面就会不传 dispatch 的跑一遍应用粗体效果的 Command, 此时判定是 false, 工具栏的粗体就会被 disable 掉
export type Command = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean

const UPDATED_SEL = 1, UPDATED_MARKS = 2, UPDATED_SCROLL = 4

/// An editor state transaction, which can be applied to a state to
/// create an updated state. Use
/// [`EditorState.tr`](#state.EditorState.tr) to create an instance.
///
/// @cn 一个编辑器 state 的 transaction 可以被用来应用到 state 以创建一个更新的 state。
/// 使用 [`EditorState.tr`](#state.EditorState.tr) 来创建一个 transaction 实例。
//
/// Transactions track changes to the document (they are a subclass of
/// [`Transform`](#transform.Transform)), but also other state changes,
/// like selection updates and adjustments of the set of [stored
/// marks](#state.EditorState.storedMarks). In addition, you can store
/// metadata properties in a transaction, which are extra pieces of
/// information that client code or plugins can use to describe what a
/// transaction represents, so that they can update their [own
/// state](#state.StateField) accordingly.
///
/// @cn Transactions （它是 [`Transform`](#transform.Transform) 的子类）不仅会追踪对文档的修改，还能追踪 state 的其他变化，
/// 比如选区更新以及 [storedmarks](#state.EditorState.storedMarks) 的调整。此外，你还可以在 transaction 中储存 metadata 信息，
/// metadata 信息是一种很有用的信息形式以告诉客户端代码或者该 transaction 所代表的含义，然后它们以此来相应的更新它们 [自己的 state](#state.StateField)。
///
/// The [editor view](#view.EditorView) uses a few metadata
/// properties: it will attach a property `"pointer"` with the value
/// `true` to selection transactions directly caused by mouse or touch
/// input, a `"composition"` property holding an ID identifying the
/// composition that caused it to transactions caused by composed DOM
/// input, and a `"uiEvent"` property of that may be `"paste"`,
/// `"cut"`, or `"drop"`.
///
/// @cn [编辑器的 view](#view.EditorView) 使用下面几个 metadata 属性：它会在 tr 上附加上 `"pointer"` 属性，值 `true` 表示由鼠标或者触摸点击触发的选区 transaction，
/// 以及一个 `"uiEvent"` 属性，值可能是 `"paste"`, `"cut"` 或者 `"drop"`。
export class Transaction extends Transform {
  /// The timestamp associated with this transaction, in the same
  /// format as `Date.now()`.
  ///
  /// @cn 与当前 transaction 关联的时间戳，与 `Date.now()` 格式相同。
  time: number

  private curSelection: Selection
  // The step count for which the current selection is valid.
  private curSelectionFor = 0
  // Bitfield to track which aspects of the state were updated by
  // this transaction.
  private updated = 0
  // Object used to store metadata properties for the transaction.
  private meta: {[name: string]: any} = Object.create(null)

  /// The stored marks set by this transaction, if any.
  ///
  /// @cn 当前 transaction 设置的 stored marks，如果有的话。
  storedMarks: readonly Mark[] | null

  /// @internal
  constructor(state: EditorState) {
    super(state.doc)
    this.time = Date.now()
    this.curSelection = state.selection
    this.storedMarks = state.storedMarks
  }

  /// The transaction's current selection. This defaults to the editor
  /// selection [mapped](#state.Selection.map) through the steps in the
  /// transaction, but can be overwritten with
  /// [`setSelection`](#state.Transaction.setSelection).
  ///
  /// @cn 该 transaction 的选区。默认是编辑器当前选区经过该 transaction [mapped](#state.Selection.map) 后的选区，
  /// 不过也会被 [`setSelection`](#state.Transaction.setSelection) 方法给手动设置。
  get selection(): Selection {
    if (this.curSelectionFor < this.steps.length) {
      this.curSelection = this.curSelection.map(this.doc, this.mapping.slice(this.curSelectionFor))
      this.curSelectionFor = this.steps.length
    }
    return this.curSelection
  }

  /// Update the transaction's current selection. Will determine the
  /// selection that the editor gets when the transaction is applied.
  ///
  /// @cn 更新当前 transaction 的选区。其会决定 transaction 应用后编辑器的选区。
  setSelection(selection: Selection): this {
    if (selection.$from.doc != this.doc)
      throw new RangeError("Selection passed to setSelection must point at the current document")
    this.curSelection = selection
    this.curSelectionFor = this.steps.length
    this.updated = (this.updated | UPDATED_SEL) & ~UPDATED_MARKS
    this.storedMarks = null
    return this
  }

  /// Whether the selection was explicitly updated by this transaction.
  ///
  /// @cn 选区是否被该 transaction 显式更新过。
  ///
  /// @comment 即在当前 transaction 中是否显式调用过 setSelection，一个 tr 在应用到 state 之前会 `流过` 所有的 plugin 的 apply 方法，因此这对于判断其他插件是否显式设置过选区很有用。
  get selectionSet() {
    return (this.updated & UPDATED_SEL) > 0
  }

  /// Set the current stored marks.
  ///
  /// @cn 设置 stored marks。
  setStoredMarks(marks: readonly Mark[] | null): this {
    this.storedMarks = marks
    this.updated |= UPDATED_MARKS
    return this
  }

  /// Make sure the current stored marks or, if that is null, the marks
  /// at the selection, match the given set of marks. Does nothing if
  /// this is already the case.
  ///
  /// @cn 确保 transaction 设置的 stored marks 或者如果 transaction 没有设置 stored marks 的话，确保光标位置的 marks，与参数给定的 marks 一致。
  /// 如果一致的话什么也不做。
  ///
  /// @comment 如果不一致的话，就让它们一致--这也是「确保」的含义。
  ensureMarks(marks: readonly Mark[]): this {
    if (!Mark.sameSet(this.storedMarks || this.selection.$from.marks(), marks))
      this.setStoredMarks(marks)
    return this
  }

  /// Add a mark to the set of stored marks.
  ///
  /// @cn 在已经设置的 stored marks 集合中增加一个 mark。
  addStoredMark(mark: Mark): this {
    return this.ensureMarks(mark.addToSet(this.storedMarks || this.selection.$head.marks()))
  }

  /// Remove a mark or mark type from the set of stored marks.
  ///
  /// @cn 在已经设置的 stored marks 集合中移除一个 mark 或者移除一种 mark。
  removeStoredMark(mark: Mark | MarkType): this {
    return this.ensureMarks(mark.removeFromSet(this.storedMarks || this.selection.$head.marks()))
  }

  /// Whether the stored marks were explicitly set for this transaction.
  ///
  /// @cn 当前 transaction 是否显式设置了 stored marks。
  get storedMarksSet() {
    return (this.updated & UPDATED_MARKS) > 0
  }

  /// @internal
  addStep(step: Step, doc: Node) {
    super.addStep(step, doc)
    this.updated = this.updated & ~UPDATED_MARKS
    this.storedMarks = null
  }

  /// Update the timestamp for the transaction.
  ///
  /// @cn 更新该 transaction 的时间戳。
  setTime(time: number): this {
    this.time = time
    return this
  }

  /// Replace the current selection with the given slice.
  ///
  /// @cn 用给定的 slice 替换当前选区。
  replaceSelection(slice: Slice): this {
    this.selection.replace(this, slice)
    return this
  }

  /// Replace the selection with the given node. When `inheritMarks` is
  /// true and the content is inline, it inherits the marks from the
  /// place where it is inserted.
  ///
  /// @cn 用给定的 node 替换当前选区。如果 `inheritMarks` 是 true 并且 node 的内容是 inline 的话，插入的内容将会继承插入点位置的 marks。
  replaceSelectionWith(node: Node, inheritMarks = true): this {
    let selection = this.selection
    if (inheritMarks)
      node = node.mark(this.storedMarks || (selection.empty ? selection.$from.marks() : (selection.$from.marksAcross(selection.$to) || Mark.none)))
    selection.replaceWith(this, node)
    return this
  }

  /// Delete the selection.
  ///
  /// @cn 删除选区。
  ///
  /// @comment 选区被删除了，其内容也一起被删除。
  deleteSelection(): this {
    this.selection.replace(this)
    return this
  }

  /// Replace the given range, or the selection if no range is given,
  /// with a text node containing the given string.
  ///
  /// @cn 用包含给定文本的文本节点替换给定的 range，如果没有给定 range 的话则替换选区。
  ///
  /// @comment range 就是用 from 和 to 表示的一个范围
  insertText(text: string, from?: number, to?: number): this {
    let schema = this.doc.type.schema
    if (from == null) {
      if (!text) return this.deleteSelection()
      return this.replaceSelectionWith(schema.text(text), true)
    } else {
      if (to == null) to = from
      to = to == null ? from : to
      if (!text) return this.deleteRange(from, to)
      let marks = this.storedMarks
      if (!marks) {
        let $from = this.doc.resolve(from)
        marks = to == from ? $from.marks() : $from.marksAcross(this.doc.resolve(to))
      }
      this.replaceRangeWith(from, to, schema.text(text, marks))
      if (!this.selection.empty) this.setSelection(Selection.near(this.selection.$to))
      return this
    }
  }

  /// Store a metadata property in this transaction, keyed either by
  /// name or by plugin.
  ///
  /// @cn 在该 transaction 上储存一个 metadata 信息，可以以 name 或者 plugin 来区分。
  ///
  /// @comment 因为一个 transaction 可能会被不同的 plugin 设置不同的 metadata 信息，因此需要区分。key 可以传 PluginKey，或者简单一个字符串。
  setMeta(key: string | Plugin | PluginKey, value: any): this {
    this.meta[typeof key == "string" ? key : key.key] = value
    return this
  }

  /// Retrieve a metadata property for a given name or plugin.
  ///
  /// @cn 用给定的 name 或者 plugin key 来获取设置的 metadata 信息。
  ///
  /// @comment 给定的 name 或者 plugin key 就是上面 setMeta 设置的 key，获取的就是 setMeta 设置的 value。
  getMeta(key: string | Plugin | PluginKey) {
    return this.meta[typeof key == "string" ? key : key.key]
  }

  /// Returns true if this transaction doesn't contain any metadata,
  /// and can thus safely be extended.
  ///
  /// @cn 如果该 transaction 没有包含任何 metadata 信息则返回 true，如此以来就可以被安全的扩展。
  ///
  /// @comment 有些场景需要对 transaction 做一些额外处理，如合并多个 step，此时如果某个 step 有 metadata 信息，则说明该 step 对某个 plugin 可能有其他的用途，就不能简单的合并 step。
  get isGeneric() {
    for (let _ in this.meta) return false
    return true
  }

  /// Indicate that the editor should scroll the selection into view
  /// when updated to the state produced by this transaction.
  ///
  /// @cn 当该 transaction 更新完 state 后，让编辑器将选区滚动到视图窗口之内。
  ///
  /// @comment 类似 chrome devtools 中，Elements 下对某个元素右键的 「Scroll into view」
  scrollIntoView(): this {
    this.updated |= UPDATED_SCROLL
    return this
  }

  /// True when this transaction has had `scrollIntoView` called on it.
  ///
  /// @cn 当前 transaction 被调用过`scrollIntoView`就会返回 True
  get scrolledIntoView() {
    return (this.updated & UPDATED_SCROLL) > 0
  }
}
