import escapeStringRegexp from 'escape-string-regexp';

type Filter = {
  test: (text: string) => boolean
  noFilter: boolean
}

const toRegexp = (regex: string) => new RegExp(regex, "i");

export type FilterType = 'simple' | 'regex';

export function parseFilter(filterString?: string, type?: FilterType): Filter {
  const predicates: RegExp[] = [];
  if (filterString) {
    switch (type) {
      case 'regex':
        if (!/^\^?\.?\*\$?$/.test(filterString) && escapeStringRegexp(filterString).indexOf("\\") > -1) { //regexp must not be relevant: not '.*' and an actual regexp (nothing escaped when escaping -> not a regexp)
          predicates.push(toRegexp(filterString));
        }
        break;
      default:
        const filters = filterString.split(',').map(f => f.trim());
        if (!filters.some(filter => /^\*(?:ALL)?$/.test(filter)) && (filters.length > 1 || filters[0].includes('*'))) { //*, *ALL or a single value with no '*' is not a filter
          predicates.push(...filters
            .map(filter => escapeStringRegexp(filter))
            .map(filter => toRegexp(`^${filter.replaceAll('\\*', '.*')}$`))); //* has been escaped, hence the '\\*'
        }
    }
  }

  if (predicates.length) {
    return {
      test: (text) => predicates.some(regExp => regExp.test(text)),
      noFilter: false
    }
  }
  else {
    return {
      test: () => true,
      noFilter: true
    }
  }
}

/**
 * Convert a regex pattern to an IBM i wildcard pattern
 * Returns both the wildcard (for OBJECT_NAME) and whether it's an exact conversion
 * @param regexString The regex pattern string
 * @returns Object with wildcard and isExact flag, or undefined if not convertible
 */
export function regexToWildcard(regexString?: string): { wildcard: string; isExact: boolean } | undefined {
  if (!regexString) return undefined;

  // Remove leading ^ and trailing $
  let pattern = regexString;
  const hasStart = pattern.startsWith('^');
  const hasEnd = pattern.endsWith('$');
  
  if (hasStart) pattern = pattern.substring(1);
  if (hasEnd) pattern = pattern.substring(0, pattern.length - 1);

  // Check if pattern contains complex regex features
  const hasComplexFeatures = /[+?[\]{}()|\\]/.test(pattern);

  let wildcard: string;
  
  // Convert .* to * first
  let simplified = pattern.replace(/\.\*/g, '*');

  // If pattern still contains dots that aren't part of .*, it's a literal dot
  if (simplified.includes('.')) {
    return undefined;
  }

  if (hasComplexFeatures) {
    // For complex patterns, extract the base alphanumeric part
    // Extract leading alphanumeric characters before complex features
    const leadingMatch = simplified.match(/^([A-Za-z0-9@#$_]+)/);
    const leadingPart = leadingMatch ? leadingMatch[1] : '';
    
    // Extract trailing alphanumeric characters after complex features
    const trailingMatch = simplified.match(/([A-Za-z0-9@#$_]+)$/);
    const trailingPart = trailingMatch ? trailingMatch[1] : '';
    
    // Prefer leading part if it exists (e.g., test[0-9]+ -> test*)
    // Otherwise use trailing part (e.g., *lib -> *lib)
    if (leadingPart.length > 0) {
      wildcard = leadingPart + '*';
    } else if (trailingPart.length > 0) {
      wildcard = '*' + trailingPart;
    } else {
      // No extractable base pattern
      return undefined;
    }
  } else {
    wildcard = simplified;
    
    // Add leading * if no start anchor and doesn't already start with *
    if (!hasStart && !wildcard.startsWith('*')) {
      wildcard = '*' + wildcard;
    }
    
    // Add trailing * if no end anchor and doesn't already end with *
    if (!hasEnd && !wildcard.endsWith('*')) {
      wildcard = wildcard + '*';
    }
  }

  // Validate the result is a valid IBM i generic name
  // Must be alphanumeric, @, #, $, _, and *
  if (!/^[A-Za-z0-9@#$_*]+$/.test(wildcard)) {
    return undefined;
  }

  // IBM i OBJECT_NAME supports: xxx*, *xxx, *xxx*, or *
  // Just ensure * is only at start and/or end, not in the middle
  const withoutLeadingStar = wildcard.startsWith('*') ? wildcard.substring(1) : wildcard;
  const withoutTrailingStar = withoutLeadingStar.endsWith('*') ? withoutLeadingStar.substring(0, withoutLeadingStar.length - 1) : withoutLeadingStar;
  
  // After removing leading and trailing *, there should be no more * in the middle
  if (withoutTrailingStar.includes('*')) {
    return undefined;
  }

  // If it has complex features, it's not an exact conversion
  // We'll use the wildcard to narrow results, then apply regex for precision
  return {
    wildcard,
    isExact: !hasComplexFeatures
  };
}

/**
 * Return filterString if it is a single, generic name filter (e.g. QSYS*)
 * Also handles regex patterns that can be converted to wildcards
 * @param filterString
 * @param filterType
 * @returns Object with wildcard and isExact flag, or string for simple filters, or undefined
 */
export function singleGenericName(filterString?: string, filterType?: FilterType): string | { wildcard: string; isExact: boolean } | undefined {
  if (!filterString) return undefined;

  // For regex type, try to convert to wildcard
  if (filterType === 'regex') {
    return regexToWildcard(filterString);
  }

  // For simple type, check if it's a single generic name
  return !filterString.includes(',') && filterString.indexOf('*') === filterString.length - 1 ? filterString : undefined;
}