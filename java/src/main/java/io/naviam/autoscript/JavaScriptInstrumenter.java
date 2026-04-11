package io.naviam.autoscript;

import org.openjdk.nashorn.api.tree.BlockTree;
import org.openjdk.nashorn.api.tree.CaseTree;
import org.openjdk.nashorn.api.tree.CompilationUnitTree;
import org.openjdk.nashorn.api.tree.ExpressionStatementTree;
import org.openjdk.nashorn.api.tree.ExpressionTree;
import org.openjdk.nashorn.api.tree.ForInLoopTree;
import org.openjdk.nashorn.api.tree.ForLoopTree;
import org.openjdk.nashorn.api.tree.ForOfLoopTree;
import org.openjdk.nashorn.api.tree.FunctionDeclarationTree;
import org.openjdk.nashorn.api.tree.FunctionExpressionTree;
import org.openjdk.nashorn.api.tree.IdentifierTree;
import org.openjdk.nashorn.api.tree.IfTree;
import org.openjdk.nashorn.api.tree.LabeledStatementTree;
import org.openjdk.nashorn.api.tree.LineMap;
import org.openjdk.nashorn.api.tree.Parser;
import org.openjdk.nashorn.api.tree.SimpleTreeVisitorES5_1;
import org.openjdk.nashorn.api.tree.StatementTree;
import org.openjdk.nashorn.api.tree.Tree;
import org.openjdk.nashorn.api.tree.TryTree;
import org.openjdk.nashorn.api.tree.VariableTree;
import org.openjdk.nashorn.api.tree.WhileLoopTree;
import org.openjdk.nashorn.api.tree.DoWhileLoopTree;
import org.openjdk.nashorn.api.tree.WithTree;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Instruments Nashorn source with line trace calls so the debug adapter can emulate statement-level stepping.
 */
final class JavaScriptInstrumenter {
    static final String DEBUGGER_ALIAS = "__autoscript_debugger";

    private JavaScriptInstrumenter() {
    }

    /**
     * Rewrites JavaScript/Nashorn source to emit debugger line and function-entry events.
     *
     * @param scriptName Maximo script name used for parser filenames and diagnostics
     * @param source     original JavaScript source
     * @return instrumented source, or the original source when empty
     */
    static String instrument(String scriptName, String source) {
        if (source == null || source.isBlank()) {
            return source;
        }

        Parser parser = Parser.create();
        CompilationUnitTree compilationUnit = parser.parse(scriptName + ".js", source, null);
        InstrumentationPlan plan = new InstrumentationPlan(source, compilationUnit.getLineMap());
        ScopeCollector collector = new ScopeCollector();
        Scope rootScope = collector.collect(compilationUnit);
        List<PositionRange> loopHeaderRanges = new LoopHeaderCollector().collect(compilationUnit);
        new InstrumentingVisitor(plan, collector.scopeByTree, loopHeaderRanges).visitCompilationUnit(compilationUnit, rootScope);
        return plan.apply();
    }

    /**
     * Collects lexical names visible at each AST node so trace snapshots can include in-scope locals.
     */
    private static final class ScopeCollector extends SimpleTreeVisitorES5_1<Void, Scope> {
        private final IdentityHashMap<Tree, Scope> scopeByTree = new IdentityHashMap<>();

        private Scope collect(CompilationUnitTree compilationUnit) {
            Scope rootScope = new Scope(null);
            rootScope.add("this");
            scopeByTree.put(compilationUnit, rootScope);
            visitCompilationUnit(compilationUnit, rootScope);
            return rootScope;
        }

        @Override
        public Void visitCompilationUnit(CompilationUnitTree node, Scope scope) {
            scopeByTree.put(node, scope);
            return super.visitCompilationUnit(node, scope);
        }

        @Override
        public Void visitFunctionDeclaration(FunctionDeclarationTree node, Scope parentScope) {
            addIdentifier(parentScope, node.getName());
            Scope functionScope = createFunctionScope(parentScope, node.getName(), node.getParameters());
            scopeByTree.put(node, functionScope);
            node.getBody().accept(this, functionScope);
            return null;
        }

        @Override
        public Void visitFunctionExpression(FunctionExpressionTree node, Scope parentScope) {
            Scope functionScope = createFunctionScope(parentScope, node.getName(), node.getParameters());
            scopeByTree.put(node, functionScope);
            Tree body = node.getBody();
            if (body != null) {
                body.accept(this, functionScope);
            }
            return null;
        }

        @Override
        public Void visitVariable(VariableTree node, Scope scope) {
            addBinding(scope, node.getBinding());
            ExpressionTree initializer = node.getInitializer();
            if (initializer != null) {
                initializer.accept(this, scope);
            }
            return null;
        }

        private Scope createFunctionScope(Scope parentScope, IdentifierTree functionName, List<? extends ExpressionTree> parameters) {
            Scope functionScope = new Scope(parentScope);
            functionScope.add("this");
            functionScope.add("arguments");
            addIdentifier(functionScope, functionName);
            if (parameters != null) {
                for (ExpressionTree parameter : parameters) {
                    addBinding(functionScope, parameter);
                }
            }
            return functionScope;
        }

        private void addBinding(Scope scope, ExpressionTree binding) {
            if (binding instanceof IdentifierTree identifierTree) {
                scope.add(identifierTree.getName());
            }
        }

        private void addIdentifier(Scope scope, IdentifierTree identifier) {
            if (identifier != null) {
                scope.add(identifier.getName());
            }
        }
    }

    /**
     * Captures loop header spans so variable declarations in headers are not double-instrumented.
     */
    private static final class LoopHeaderCollector extends SimpleTreeVisitorES5_1<Void, Void> {
        private final List<PositionRange> ranges = new ArrayList<>();

        private List<PositionRange> collect(CompilationUnitTree compilationUnit) {
            visitCompilationUnit(compilationUnit, null);
            return ranges;
        }

        @Override
        public Void visitForLoop(ForLoopTree node, Void unused) {
            addRange(node.getStartPosition(), statementStart(node.getStatement()));
            return super.visitForLoop(node, unused);
        }

        @Override
        public Void visitForInLoop(ForInLoopTree node, Void unused) {
            addRange(node.getStartPosition(), statementStart(node.getStatement()));
            return super.visitForInLoop(node, unused);
        }

        @Override
        public Void visitForOfLoop(ForOfLoopTree node, Void unused) {
            addRange(node.getStartPosition(), statementStart(node.getStatement()));
            return super.visitForOfLoop(node, unused);
        }

        private void addRange(long loopStart, int statementStart) {
            if (statementStart > loopStart) {
                ranges.add(new PositionRange((int) loopStart, statementStart));
            }
        }

        private int statementStart(StatementTree statement) {
            return statement == null ? Integer.MAX_VALUE : (int) statement.getStartPosition();
        }
    }

    /**
     * Injects trace and function-entry/exit calls into supported statement and function nodes.
     */
    private static final class InstrumentingVisitor extends SimpleTreeVisitorES5_1<Void, Scope> {
        private final InstrumentationPlan plan;
        private final IdentityHashMap<Tree, Scope> scopeByTree;
        private final List<PositionRange> loopHeaderRanges;

        private InstrumentingVisitor(
                InstrumentationPlan plan,
                IdentityHashMap<Tree, Scope> scopeByTree,
                List<PositionRange> loopHeaderRanges
        ) {
            this.plan = plan;
            this.scopeByTree = scopeByTree;
            this.loopHeaderRanges = loopHeaderRanges;
        }

        @Override
        public Void visitCompilationUnit(CompilationUnitTree node, Scope scope) {
            return super.visitCompilationUnit(node, scopeByTree.getOrDefault(node, scope));
        }

        @Override
        public Void visitBlock(BlockTree node, Scope scope) {
            return super.visitBlock(node, scope);
        }

        @Override
        public Void visitFunctionDeclaration(FunctionDeclarationTree node, Scope parentScope) {
            instrumentStatement(node, parentScope);
            Scope functionScope = scopeByTree.getOrDefault(node, parentScope);
            instrumentFunctionBody(node.getBody(), functionName(node.getName()), lineNumber(node));
            node.getBody().accept(this, functionScope);
            return null;
        }

        @Override
        public Void visitFunctionExpression(FunctionExpressionTree node, Scope parentScope) {
            Scope functionScope = scopeByTree.getOrDefault(node, parentScope);
            Tree body = node.getBody();
            if (body != null) {
                instrumentFunctionBody(body, functionName(node.getName()), lineNumber(node));
                body.accept(this, functionScope);
            }
            return null;
        }

        @Override
        public Void visitExpressionStatement(ExpressionStatementTree node, Scope scope) {
            instrumentStatement(node, scope);
            return super.visitExpressionStatement(node, scope);
        }

        @Override
        public Void visitVariable(VariableTree node, Scope scope) {
            if (!isInsideLoopHeader(node.getStartPosition())) {
                instrumentStatement(node, scope);
            }
            return super.visitVariable(node, scope);
        }

        @Override
        public Void visitIf(IfTree node, Scope scope) {
            instrumentStatement(node, scope);
            wrapControlledStatement(node.getThenStatement());
            wrapControlledStatement(node.getElseStatement());
            return super.visitIf(node, scope);
        }

        @Override
        public Void visitWhileLoop(WhileLoopTree node, Scope scope) {
            instrumentStatement(node, scope);
            instrumentLoopBody(node.getStatement(), lineNumber(node), scope);
            return super.visitWhileLoop(node, scope);
        }

        @Override
        public Void visitDoWhileLoop(DoWhileLoopTree node, Scope scope) {
            instrumentStatement(node, scope);
            instrumentLoopBody(node.getStatement(), lineNumber(node), scope);
            return super.visitDoWhileLoop(node, scope);
        }

        @Override
        public Void visitForLoop(ForLoopTree node, Scope scope) {
            instrumentStatement(node, scope);
            instrumentLoopBody(node.getStatement(), lineNumber(node), scope);
            StatementTree statement = node.getStatement();
            if (statement != null) {
                statement.accept(this, scope);
            }
            return null;
        }

        @Override
        public Void visitForInLoop(ForInLoopTree node, Scope scope) {
            instrumentStatement(node, scope);
            instrumentLoopBody(node.getStatement(), lineNumber(node), scope);
            StatementTree statement = node.getStatement();
            if (statement != null) {
                statement.accept(this, scope);
            }
            return null;
        }

        @Override
        public Void visitForOfLoop(ForOfLoopTree node, Scope scope) {
            instrumentStatement(node, scope);
            instrumentLoopBody(node.getStatement(), lineNumber(node), scope);
            StatementTree statement = node.getStatement();
            if (statement != null) {
                statement.accept(this, scope);
            }
            return null;
        }

        @Override
        public Void visitWith(WithTree node, Scope scope) {
            instrumentStatement(node, scope);
            wrapControlledStatement(node.getStatement());
            return super.visitWith(node, scope);
        }

        @Override
        public Void visitLabeledStatement(LabeledStatementTree node, Scope scope) {
            instrumentStatement(node, scope);
            wrapControlledStatement(node.getStatement());
            return super.visitLabeledStatement(node, scope);
        }

        @Override
        public Void visitTry(TryTree node, Scope scope) {
            instrumentStatement(node, scope);
            return super.visitTry(node, scope);
        }

        @Override
        public Void visitCase(CaseTree node, Scope scope) {
            List<? extends StatementTree> statements = node.getStatements();
            if (statements != null && !statements.isEmpty()) {
                int lineNumber = lineNumber(node);
                StatementTree firstStatement = statements.get(0);
                plan.insert(firstStatement.getStartPosition(), traceCall(lineNumber, scope), 40);
            }
            return super.visitCase(node, scope);
        }

        private void instrumentStatement(StatementTree node, Scope scope) {
            if (!(node instanceof BlockTree)) {
                plan.insert(node.getStartPosition(), traceCall(lineNumber(node), scope), 30);
            }
        }

        private boolean isInsideLoopHeader(long position) {
            for (PositionRange range : loopHeaderRanges) {
                if (range.contains((int) position)) {
                    return true;
                }
            }
            return false;
        }

        private void wrapControlledStatement(StatementTree statement) {
            if (statement == null || statement instanceof BlockTree) {
                return;
            }
            plan.insert(statement.getStartPosition(), "{", 50);
            plan.insert(statement.getEndPosition(), "}", 0);
        }

        private void instrumentLoopBody(StatementTree statement, int lineNumber, Scope scope) {
            if (statement == null) {
                return;
            }
            if (statement instanceof BlockTree blockTree) {
                plan.insert(blockTree.getStartPosition() + 1, traceCall(lineNumber, scope), 20);
                return;
            }
            plan.insert(statement.getStartPosition(), "{" + traceCall(lineNumber, scope), 50);
            plan.insert(statement.getEndPosition(), "}", 0);
        }

        private void instrumentFunctionBody(Tree body, String functionName, int lineNumber) {
            if (!(body instanceof BlockTree blockTree)) {
                return;
            }
            plan.insert(
                    blockTree.getStartPosition() + 1,
                    DEBUGGER_ALIAS + ".enter_js(" + stringLiteral(functionName) + "," + lineNumber + ");try{",
                    60
            );
            plan.insert(blockTree.getEndPosition(), "}finally{" + DEBUGGER_ALIAS + ".exit_js();}", 10);
        }

        private String functionName(IdentifierTree identifierTree) {
            if (identifierTree == null || identifierTree.getName() == null || identifierTree.getName().isBlank()) {
                return "<anonymous>";
            }
            return identifierTree.getName();
        }

        private String stringLiteral(String value) {
            String escaped = value
                    .replace("\\", "\\\\")
                    .replace("\"", "\\\"");
            return "\"" + escaped + "\"";
        }

        private int lineNumber(Tree tree) {
            return plan.lineNumber(tree.getStartPosition());
        }

        private String traceCall(int lineNumber, Scope scope) {
            return DEBUGGER_ALIAS + ".trace_js(" + lineNumber + "," + scope.snapshotExpression() + ");";
        }
    }

    /**
     * Stores source insertions and applies them in order to produce instrumented JavaScript.
     */
    private static final class InstrumentationPlan {
        private final String source;
        private final LineMap lineMap;
        private final List<Insertion> insertions = new ArrayList<>();

        private InstrumentationPlan(String source, LineMap lineMap) {
            this.source = source;
            this.lineMap = lineMap;
        }

        private void insert(long position, String text, int priority) {
            insertions.add(new Insertion((int) position, text, priority));
        }

        private int lineNumber(long position) {
            return (int) lineMap.getLineNumber(position);
        }

        private String apply() {
            insertions.sort((left, right) -> {
                if (left.position != right.position) {
                    return Integer.compare(left.position, right.position);
                }
                return Integer.compare(right.priority, left.priority);
            });

            StringBuilder instrumented = new StringBuilder(source.length() + insertions.size() * 48);
            int sourceIndex = 0;
            int insertionIndex = 0;
            while (sourceIndex <= source.length()) {
                while (insertionIndex < insertions.size() && insertions.get(insertionIndex).position == sourceIndex) {
                    instrumented.append(insertions.get(insertionIndex).text);
                    insertionIndex++;
                }
                if (sourceIndex == source.length()) {
                    break;
                }
                instrumented.append(source.charAt(sourceIndex));
                sourceIndex++;
            }
            return instrumented.toString();
        }
    }

    /**
     * Represents one text insertion at a source offset with relative ordering priority.
     */
    private record Insertion(int position, String text, int priority) {
    }

    /**
     * Represents nested lexical names and builds safe locals snapshot expressions.
     */
    private static final class Scope {
        private final Scope parent;
        private final LinkedHashSet<String> names = new LinkedHashSet<>();

        private Scope(Scope parent) {
            this.parent = parent;
        }

        private void add(String name) {
            if (name != null && !name.isBlank()) {
                names.add(name);
            }
        }

        private Set<String> visibleNames() {
            LinkedHashSet<String> visible = new LinkedHashSet<>();
            if (parent != null) {
                visible.addAll(parent.visibleNames());
            }
            visible.addAll(names);
            return visible;
        }

        private String snapshotExpression() {
            StringBuilder snapshot = new StringBuilder("{");
            boolean first = true;
            for (String name : visibleNames()) {
                if (!first) {
                    snapshot.append(',');
                }
                first = false;
                snapshot.append('\'')
                        .append(escape(name))
                        .append("':(function(){try{return ")
                        .append(name)
                        .append(";}catch(e){return undefined;}})()");
            }
            snapshot.append('}');
            return snapshot.toString();
        }

        private String escape(String value) {
            return value.replace("\\", "\\\\").replace("'", "\\'");
        }
    }

    /**
     * Marks a half-open source span used to skip instrumentation in loop headers.
     */
    private record PositionRange(int start, int end) {

        private boolean contains(int position) {
            return position > start && position < end;
        }
    }
}
