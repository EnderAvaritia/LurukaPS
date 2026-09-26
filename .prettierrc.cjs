// .prettierrc.cjs
module.exports = {
    // 一行最多 120 字符
    printWidth: 120,
    // 使用 4 个空格缩进
    tabWidth: 4,
    // 不使用缩进符，而使用空格
    useTabs: false,
    // 行尾不使用分号
    semi: false,
    // 使用单引号
    singleQuote: true,
    // 对象的 key 仅在必要时用引号
    quoteProps: 'as-needed',
    // jsx 标签内不使用单引号，而使用双引号
    jsxSingleQuote: false,
    // 在支持的位置都添加末尾逗号
    trailingComma: 'all',
    // 大括号内的首尾需要空格
    bracketSpacing: true,
    // 箭头函数，只有一个参数的时候，也需要括号
    arrowParens: 'always',
    // 每个文件格式化的范围是文件的全部内容
    rangeStart: 0,
    rangeEnd: Infinity,
    // 不需要写文件开头的 @prettier
    requirePragma: false,
    // 不需要自动在文件开头插入 @prettier
    insertPragma: false,
    // 保持 Markdown 等纯文本原有的换行方式
    proseWrap: 'preserve',
    // 根据 CSS display 样式决定 HTML 空白和换行的处理方式
    htmlWhitespaceSensitivity: 'css',
    // vue 文件中的 script 和 style 内不用缩进
    vueIndentScriptAndStyle: false,
    // 自动沿用文件现有的换行符
    endOfLine: 'auto',
    // 格式化嵌入的内容
    embeddedLanguageFormatting: 'auto',
}
