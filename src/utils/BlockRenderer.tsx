/**
 * File: utils/BlockRenderer.tsx
 * Purpose: Renders template blocks for PDF generation
 * Author: LPai Team
 * Last Modified: 2025-09-03
 * Dependencies: React, quote data
 */

import React from 'react';

interface BlockRendererProps {
  block: any;
  styling: {
    primaryColor: string;
    accentColor: string;
  };
  variables: Record<string, string>;
  quote: any;
}

const BlockRenderer: React.FC<BlockRendererProps> = ({ 
  block, 
  styling, 
  variables, 
  quote 
}) => {
  const replaceVariables = (text: string): string => {
    let result = text;
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{${key}}`, 'g');
      result = result.replace(regex, value || `{${key}}`);
    });
    return result;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  switch (block.type) {
    case 'hero':
      return (
        <div 
          className="hero-section text-white rounded-lg text-center pt-1 pb-4 mb-4 mx-auto max-w-4xl"
          style={{ backgroundColor: styling.primaryColor }}
        >
          {block.content.icon && (
            <div className="text-5xl mb-4">{block.content.icon}</div>
          )}
          <h1 className="text-4xl font-bold mb-2">
            {replaceVariables(block.content.title)}
          </h1>
          {block.content.subtitle && (
            <p className="text-xl opacity-90">
              {replaceVariables(block.content.subtitle)}
            </p>
          )}
        </div>
      );

    case 'quote_header':
      return (
        <div className="bg-gray-50 p-4 rounded-lg mb-4 mx-auto max-w-4xl">
          <h2 
            className="text-3xl font-bold mb-2"
            style={{ color: styling.primaryColor }}
          >
            {replaceVariables(block.content.title)}
          </h2>
          {block.content.subtitle && (
            <p className="text-xl text-gray-600 mb-3">
              {replaceVariables(block.content.subtitle)}
            </p>
          )}
          {block.content.customerLabel && (
            <p className="text-lg text-gray-700">
              {replaceVariables(block.content.customerLabel)}
            </p>
          )}
        </div>
      );

    case 'benefit_cards':
    case 'warranty_cards':
      return (
        <div className="benefit-grid grid gap-3 mb-4 mx-auto max-w-4xl">
          {block.content.cards.map((card: any, index: number) => (
            <div 
              key={index}
              className="bg-gray-50 p-4 rounded-lg border"
            >
              <div className="text-center mb-4">
                <div className="text-4xl mb-2">{card.icon}</div>
                <h3 
                  className="text-lg font-bold"
                  style={{ color: styling.primaryColor }}
                >
                  {replaceVariables(card.title)}
                </h3>
                <p 
                  className="text-sm font-medium mt-1"
                  style={{ color: styling.accentColor }}
                >
                  {replaceVariables(card.subtitle)}
                </p>
              </div>
              <p className="text-sm text-gray-600 text-center leading-relaxed">
                {replaceVariables(card.description)}
              </p>
            </div>
          ))}
        </div>
      );

    case 'process_steps':
      return (
        <div className="space-y-4 mb-4 mx-auto max-w-4xl">
          {block.content.steps.map((step: any, index: number) => (
            <div key={index} className="flex items-start gap-3">
              <div 
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                style={{ backgroundColor: styling.primaryColor }}
              >
                {step.stepNumber}
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-lg text-gray-900 mb-1">
                  {step.title}
                </h4>
                <p className="text-sm text-gray-600 mb-2">
                  Timeline: {step.time}
                </p>
                <p className="text-gray-700">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      );

    case 'contact_info':
      return (
        <div className="bg-gray-50 p-4 rounded-lg mb-4 mx-auto max-w-4xl">
          <h3 
            className="text-xl font-bold mb-4"
            style={{ color: styling.primaryColor }}
          >
            {replaceVariables(block.content.title)}
          </h3>
          <div className="space-y-1">
            {block.content.items.map((item: any, index: number) => {
              const processedValue = replaceVariables(item.value);
              console.log(`[ContactInfo] Processing "${item.value}" -> "${processedValue}"`);
              
              return (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-2xl">{item.icon}</span>
                  <div>
                    <span className="font-medium text-gray-700">{item.label}:</span>
                    <span className="ml-2 text-gray-900">
                      {processedValue}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );

    case 'quote_breakdown':
      return (
        <div className="mb-4 mx-auto max-w-4xl">
          <h3 
            className="text-xl font-bold mb-4"
            style={{ color: styling.primaryColor }}
          >
            {block.content.title}
          </h3>
          
          {/* Quote sections table */}
          {quote.sections && quote.sections.length > 0 && (
            <div className="space-y-4">
              {quote.sections.map((section: any) => (
                <div key={section.id} className="border rounded-lg overflow-hidden mb-4">
                  <div 
                    className="px-4 py-2 text-white font-bold"
                    style={{ backgroundColor: styling.primaryColor }}
                  >
                    {section.name}
                  </div>
                  
                  <div className="w-full">
                    <div className="grid grid-cols-4 gap-4 p-3 bg-gray-50 font-semibold text-sm border-b">
                      <div>Description</div>
                      <div className="text-center">Qty</div>
                      <div className="text-right">Unit Price</div>
                      <div className="text-right">Total</div>
                    </div>
                    
                    {section.lineItems.map((item: any) => (
                      <div key={item.id} className="grid grid-cols-4 gap-4 p-3 border-b text-sm">
                        <div>
                          <div className="font-medium">{item.name}</div>
                          {item.description && (
                            <div className="text-xs text-gray-600 mt-1">{item.description}</div>
                          )}
                        </div>
                        <div className="text-center">{item.quantity}</div>
                        <div className="text-right">{formatCurrency(item.unitPrice)}</div>
                        <div className="text-right font-medium">{formatCurrency(item.totalPrice)}</div>
                      </div>
                    ))}
                    
                    <div className="grid grid-cols-4 gap-4 p-3 bg-gray-100 font-bold text-sm">
                      <div className="col-span-3 text-right">Section Total:</div>
                      <div className="text-right">{formatCurrency(section.subtotal)}</div>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Quote totals */}
              <div className="border-t-2 pt-4">
                <table className="w-full max-w-sm ml-auto">
                  <tbody>
                    <tr>
                      <td className="text-right py-1 font-medium">Subtotal:</td>
                      <td className="text-right py-1 pl-4">{formatCurrency(quote.subtotal)}</td>
                    </tr>
                    {quote.discountAmount > 0 && (
                      <tr>
                        <td className="text-right py-1 font-medium text-green-600">
                          Discount ({quote.discountPercentage}%):
                        </td>
                        <td className="text-right py-1 pl-4 text-green-600">
                          -{formatCurrency(quote.discountAmount)}
                        </td>
                      </tr>
                    )}
                    {quote.taxAmount > 0 && (
                      <tr>
                        <td className="text-right py-1 font-medium">
                          Tax ({(quote.taxRate * 100).toFixed(1)}%):
                        </td>
                        <td className="text-right py-1 pl-4">{formatCurrency(quote.taxAmount)}</td>
                      </tr>
                    )}
                    <tr className="border-t-2" style={{ borderColor: styling.primaryColor }}>
                      <td 
                        className="text-right py-2 text-xl font-bold"
                        style={{ color: styling.primaryColor }}
                      >
                        Total:
                      </td>
                      <td 
                        className="text-right py-2 pl-4 text-xl font-bold"
                        style={{ color: styling.primaryColor }}
                      >
                        {formatCurrency(quote.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );

    case 'service_list':
    case 'scope_list':
      return (
        <div className="mb-4 mx-auto max-w-4xl">
          <h3 
            className="text-xl font-bold mb-4"
            style={{ color: styling.primaryColor }}
          >
            {block.content.title}
          </h3>
          <div className="space-y-1">
            {block.content.items.map((item: string, index: number) => (
              <div key={index} className="flex items-start gap-2">
                <span className="text-green-500 mt-1">✓</span>
                <span className="text-gray-700">{replaceVariables(item)}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case 'specifications':
      return (
        <div className="space-y-4 mb-4 mx-auto max-w-4xl">
          {block.content.specs.map((spec: any, index: number) => (
            <div key={index}>
              <h4 
                className="text-lg font-bold mb-3"
                style={{ color: styling.primaryColor }}
              >
                {spec.title}
              </h4>
              <div className="space-y-1 pl-4">
                {spec.items.map((item: string, itemIndex: number) => (
                  <p key={itemIndex} className="text-gray-700">
                    {item}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      );

    case 'text_section':
      return (
        <div className="mb-4 mx-auto max-w-4xl">
          <h3 
            className="text-xl font-bold mb-4"
            style={{ color: styling.primaryColor }}
          >
            {block.content.title}
          </h3>
          <div className="text-gray-700 leading-relaxed">
            {replaceVariables(block.content.content).split('\n').map((paragraph, index) => (
              <p key={index} className="mb-3">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      );

    case 'terms_section':
      return (
        <div className="bg-gray-50 p-4 rounded-lg mb-4 mx-auto max-w-4xl">
          <h3 
            className="text-xl font-bold mb-4"
            style={{ color: styling.primaryColor }}
          >
            {block.content.title}
          </h3>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
            {replaceVariables(block.content.content)}
          </div>
        </div>
      );

    case 'scope_display':
      return (
        <div className="mb-4 mx-auto max-w-4xl">
          <h3 
            className="text-xl font-bold mb-4"
            style={{ color: styling.primaryColor }}
          >
            {block.content.title || 'Scope of Work'}
          </h3>
          {quote?.scopeItems && Array.isArray(quote.scopeItems) && quote.scopeItems.length > 0 ? (
            <div className="space-y-4">
              {quote.scopeItems.map((scopeItem: any, index: number) => (
                <div key={index}>
                  <div className="font-semibold text-gray-900 mb-2">
                    • {scopeItem.mainItem}
                  </div>
                  {scopeItem.subItems && scopeItem.subItems.length > 0 && (
                    <div className="ml-6 space-y-1">
                      {scopeItem.subItems.map((subItem: string, subIndex: number) => (
                        <div key={subIndex} className="text-gray-700 text-sm">
                          ◦ {subItem}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 italic">
              {block.content.emptyMessage || 'Scope will be defined during quote preparation'}
            </p>
          )}
        </div>
      );

    default:
      return (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-yellow-800">
            Unknown block type: {block.type}
          </p>
        </div>
      );
  }
};

export default BlockRenderer;