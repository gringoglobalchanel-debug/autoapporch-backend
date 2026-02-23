/**
 * Servicio de validación de código generado
 * Evita que código con errores llegue al usuario
 */

export class ValidationService {
  /**
   * Validar código JSX/JavaScript completo
   */
  validateGeneratedCode(code) {
    const errors = [];
    const warnings = [];

    // 1. Validar balance de etiquetas HTML/JSX
    this.validateTagBalance(code, errors);

    // 2. Validar llaves de JavaScript
    this.validateBraceBalance(code, errors);

    // 3. Validar paréntesis
    this.validateParenBalance(code, errors);

    // 4. Validar corchetes (arrays)
    this.validateBracketBalance(code, errors);

    // 5. Validar etiquetas sin cerrar
    this.validateUnclosedTags(code, errors);

    // 6. Validar imports
    this.validateImports(code, errors, warnings);

    // 7. Validar exports
    this.validateExports(code, errors);

    // 8. Validar sintaxis básica de React
    this.validateReactSyntax(code, errors, warnings);

    // 9. Validar caracteres inválidos
    this.validateInvalidChars(code, warnings);

    // 10. NUEVA: Validar cadenas sin cerrar
    const stringErrors = this.validateUnterminatedStrings(code);
    errors.push(...stringErrors);

    // 11. NUEVA: Validar JSX strings
    const jsxWarnings = this.validateJSXStrings(code);
    warnings.push(...jsxWarnings);

    // Calcular score
    const score = this.calculateScore(errors, warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      score,
      summary: this.generateSummary(errors, warnings, score)
    };
  }

  /**
   * Validar balance de etiquetas
   */
  validateTagBalance(code, errors) {
    const openTags = this.findTags(code, /<[a-zA-Z][^>/]*>/g);
    const closeTags = this.findTags(code, /<\/[a-zA-Z][^>]*>/g);

    const totalOpen = openTags.length;
    const totalClose = closeTags.length;

    if (totalOpen !== totalClose) {
      errors.push({
        type: 'TAG_MISMATCH',
        severity: 'error',
        message: `Etiquetas desbalanceadas: ${totalOpen} abiertas, ${totalClose} cerradas`,
        suggestion: 'Revisa que cada etiqueta abierta tenga su correspondiente cierre'
      });
    }
  }

  /**
   * Validar llaves
   */
  validateBraceBalance(code, errors) {
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;

    if (openBraces !== closeBraces) {
      errors.push({
        type: 'BRACE_MISMATCH',
        severity: 'error',
        message: `Llaves desbalanceadas: {${openBraces} abiertas, }${closeBraces} cerradas`,
        suggestion: 'Verifica que cada { tenga su correspondiente }'
      });
    }
  }

  /**
   * Validar paréntesis
   */
  validateParenBalance(code, errors) {
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;

    if (openParens !== closeParens) {
      errors.push({
        type: 'PAREN_MISMATCH',
        severity: 'error',
        message: `Paréntesis desbalanceados: (${openParens} abiertos, )${closeParens} cerrados`,
        suggestion: 'Verifica que cada ( tenga su correspondiente )'
      });
    }
  }

  /**
   * Validar corchetes
   */
  validateBracketBalance(code, errors) {
    const openBrackets = (code.match(/\[/g) || []).length;
    const closeBrackets = (code.match(/\]/g) || []).length;

    if (openBrackets !== closeBrackets) {
      errors.push({
        type: 'BRACKET_MISMATCH',
        severity: 'error',
        message: `Corchetes desbalanceados: [${openBrackets} abiertos, ]${closeBrackets} cerrados`,
        suggestion: 'Verifica que cada [ tenga su correspondiente ]'
      });
    }
  }

  /**
   * Validar etiquetas sin cerrar
   */
  validateUnclosedTags(code, errors) {
    const unclosedTags = this.findUnclosedTags(code);
    if (unclosedTags.length > 0) {
      errors.push({
        type: 'UNCLOSED_TAGS',
        severity: 'error',
        message: `Etiquetas sin cerrar: ${unclosedTags.join(', ')}`,
        details: unclosedTags,
        suggestion: 'Cierra todas las etiquetas abiertas'
      });
    }
  }

  /**
   * Validar imports
   */
  validateImports(code, errors, warnings) {
    if (!code.includes("import React from 'react'") && !code.includes('import React,')) {
      warnings.push({
        type: 'MISSING_REACT_IMPORT',
        severity: 'warning',
        message: 'No se encontró import de React explícito',
        suggestion: 'Agrega "import React from \'react\'" al inicio del archivo'
      });
    }
  }

  /**
   * Validar exports
   */
  validateExports(code, errors) {
    const hasExport = code.includes('export default') || code.includes('export {');
    if (!hasExport) {
      errors.push({
        type: 'MISSING_EXPORT',
        severity: 'error',
        message: 'No se encontró export default',
        suggestion: 'Agrega "export default App;" al final del archivo'
      });
    }
  }

  /**
   * Validar sintaxis de React
   */
  validateReactSyntax(code, errors, warnings) {
    const hasComponent = /function \w+\(\)|const \w+ = \(\) =>|class \w+ extends/.test(code);
    if (!hasComponent) {
      errors.push({
        type: 'MISSING_COMPONENT',
        severity: 'error',
        message: 'No se encontró un componente React válido',
        suggestion: 'Define un componente function App() {{ ... }}'
      });
    }
  }

  /**
   * Validar caracteres inválidos
   */
  validateInvalidChars(code, warnings) {
    const invalidChars = [];
    const invalidCharRegex = /[^\x20-\x7E\n\r\t]/g;
    let match;

    while ((match = invalidCharRegex.exec(code)) !== null) {
      invalidChars.push({
        char: match[0],
        position: match.index,
        code: match[0].charCodeAt(0)
      });
    }

    if (invalidChars.length > 0) {
      warnings.push({
        type: 'INVALID_CHARS',
        severity: 'warning',
        message: `Se encontraron ${invalidChars.length} caracter(es) inválido(s)`,
        suggestion: 'Elimina caracteres no imprimibles'
      });
    }
  }

  /**
   * NUEVO: Validar cadenas sin cerrar
   */
  validateUnterminatedStrings(code) {
    const errors = [];
    const lines = code.split('\n');
    
    let inString = false;
    let stringChar = '';
    let stringStartLine = 0;
    let stringStartCol = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const prevChar = j > 0 ? line[j-1] : '';
        
        // Ignorar caracteres escapados
        if (prevChar === '\\') {
          continue;
        }
        
        // Detectar inicio/fin de cadena
        if ((char === '"' || char === "'" || char === '`') && !inString) {
          inString = true;
          stringChar = char;
          stringStartLine = i + 1;
          stringStartCol = j + 1;
        } else if (char === stringChar && inString) {
          inString = false;
        }
      }
    }
    
    if (inString) {
      errors.push({
        type: 'UNTERMINATED_STRING',
        severity: 'error',
        message: `Cadena sin cerrar que empezó en línea ${stringStartLine}, columna ${stringStartCol}`,
        location: {
          line: stringStartLine,
          column: stringStartCol
        },
        suggestion: 'Cierra la cadena con las comillas correspondientes'
      });
    }
    
    return errors;
  }

  /**
   * NUEVO: Validar JSX strings
   */
  validateJSXStrings(code) {
    const warnings = [];
    
    const jsxAttributeRegex = /(\w+)=["']([^"']*)$/gm;
    let match;
    
    while ((match = jsxAttributeRegex.exec(code)) !== null) {
      const lineNumber = code.substring(0, match.index).split('\n').length;
      
      warnings.push({
        type: 'POSSIBLE_UNTERMINATED_JSX_STRING',
        severity: 'warning',
        message: `Posible cadena sin cerrar en atributo JSX: ${match[0]}`,
        location: { line: lineNumber },
        suggestion: 'Asegúrate de que todas las comillas en atributos JSX estén cerradas'
      });
    }
    
    return warnings;
  }

  findTags(code, regex) {
    const matches = [];
    let match;
    while ((match = regex.exec(code)) !== null) {
      matches.push(match[0]);
    }
    return matches;
  }

  findUnclosedTags(code) {
    const stack = [];
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    let match;

    while ((match = tagRegex.exec(code)) !== null) {
      const tag = match[0];
      const tagName = match[1];
      
      if (tag.startsWith('</')) {
        if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
          return [tagName];
        } else {
          stack.pop();
        }
      } else if (!tag.endsWith('/>')) {
        stack.push(tagName);
      }
    }

    return stack;
  }

  calculateScore(errors, warnings) {
    let score = 100;
    score -= errors.length * 15;
    score -= warnings.length * 3;
    return Math.max(0, Math.min(100, score));
  }

  generateSummary(errors, warnings, score) {
    return {
      score,
      grade: this.getGrade(score),
      errorsCount: errors.length,
      warningsCount: warnings.length,
      isPassing: errors.length === 0 && score >= 70,
      message: this.getSummaryMessage(errors.length, warnings.length, score)
    };
  }

  getGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  getSummaryMessage(errors, warnings, score) {
    if (errors === 0 && score === 100) return '✅ Código perfecto';
    if (errors === 0) return `⚠️ Código válido con ${warnings} advertencia(s)`;
    return `❌ Se encontraron ${errors} error(es) críticos`;
  }
}

// Exportación nombrada
export const validationService = new ValidationService();